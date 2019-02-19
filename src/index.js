import assert from 'assert'
import { Schema } from 'mongoose'
import Promise, { join } from 'bluebird'
import jsonpatch from 'fast-json-patch'
import { decamelize, pascalize } from 'humps'
import { dropRightWhile, each, map, merge, omit, get, tail } from 'lodash'

export const RollbackError = function(message, extra) {
  Error.captureStackTrace(this, this.constructor)
  this.name = 'RollbackError'
  this.message = message
}

require('util').inherits(RollbackError, Error)

const createPatchModel = options => {
  const def = {
    date: { type: Date, required: true, default: Date.now },
    ops: { type: [], required: true },
    ref: { type: options._idType, required: true, index: true },
  }

  each(options.includes, (type, name) => {
    def[name] = omit(type, 'from')
  })

  const PatchSchema = new Schema(def)

  return options.mongoose.model(
    options.transforms[0](`${options.name}`),
    PatchSchema,
    options.transforms[1](`${options.name}`)
  )
}

const defaultOptions = {
  includes: {},
  exclude: [],
  removePatches: true,
  transforms: [pascalize, decamelize],
  trackOriginalValue: false,
}

// used to convert bson to json - especially ObjectID references need
// to be converted to hex strings so that the jsonpatch `compare` method
// works correctly
const toJSON = obj => JSON.parse(JSON.stringify(obj))

export default function(schema, opts) {
  const options = merge({}, defaultOptions, opts)

  // get _id type from schema
  options._idType = schema.tree._id.type

  // validate parameters
  assert(options.mongoose, '`mongoose` option must be defined')
  assert(options.name, '`name` option must be defined')
  assert(!schema.methods.data, 'conflicting instance method: `data`')
  assert(options._idType, 'schema is missing an `_id` property')

  // used to compare instance data snapshots. depopulates instance,
  // removes version key and object id
  schema.methods.data = function() {
    return this.toObject({
      depopulate: true,
      versionKey: false,
      transform: (doc, ret, options) => {
        delete ret._id
        // if timestamps option is set on schema, ignore timestamp fields
        if (schema.options.timestamps) {
          delete ret[schema.options.timestamps.createdAt || 'createdAt']
          delete ret[schema.options.timestamps.updatedAt || 'updatedAt']
        }
      },
    })
  }

  // roll the document back to the state of a given patch id()
  schema.methods.rollback = function(patchId, data) {
    return this.patches
      .find({ ref: this.id })
      .sort({ date: 1 })
      .exec()
      .then(
        patches =>
          new Promise((resolve, reject) => {
            // patch doesn't exist
            if (!~map(patches, 'id').indexOf(patchId)) {
              return reject(new RollbackError("patch doesn't exist"))
            }

            // get all patches that should be applied
            const apply = dropRightWhile(patches, patch => patch.id !== patchId)

            // if the patches that are going to be applied are all existing patches,
            // the rollback attempts to rollback to the latest patch
            if (patches.length === apply.length) {
              return reject(new RollbackError('rollback to latest patch'))
            }

            // apply patches to `state`
            const state = {}
            apply.forEach(patch => {
              jsonpatch.applyPatch(state, patch.ops, true)
            })

            // save new state and resolve with the resulting document
            this.set(merge(data, state))
              .save()
              .then(resolve)
              .catch(reject)
          })
      )
  }

  // create patch model, enable static model access via `Patches` and
  // instance method access through an instances `patches` property
  const Patches = createPatchModel(options)
  schema.statics.Patches = Patches
  schema.virtual('patches').get(() => Patches)

  // after a document is initialized or saved, fresh snapshots of the
  // documents data are created
  const snapshot = function() {
    this._original = toJSON(this.data())
  }
  schema.post('init', snapshot)
  schema.post('save', snapshot)

  // when a document is removed and `removePatches` is not set to false ,
  // all patch documents from the associated patch collection are also removed
  function deletePatches(document) {
    const { _id: ref } = document
    return document.patches
      .find({ ref: document._id })
      .then(patches => join(patches.map(patch => patch.remove())))
  }

  schema.pre('remove', function(next) {
    if (!options.removePatches) {
      return next()
    }

    deletePatches(this)
      .then(() => next())
      .catch(next)
  })

  // when a document is saved, the json patch that reflects the changes is
  // computed. if the patch consists of one or more operations (meaning the
  // document has changed), a new patch document reflecting the changes is
  // added to the associated patch collection
  function createPatch(document, queryOptions = {}) {
    const { _id: ref } = document
    const ops = jsonpatch.compare(
      document.isNew ? {} : document._original || {},
      toJSON(document.data())
    ).filter(op => !options.exclude.includes(op.path))

    // don't save a patch when there are no changes to save
    if (!ops.length) {
      return Promise.resolve()
    }

    // track original values if enabled
    if (options.trackOriginalValue) {
      ops.map(entry => {
        const path = tail(entry.path.split('/')).join('.')
        entry.originalValue = get(
          document.isNew ? {} : document._original,
          path
        )
      })
    }

    // assemble patch data
    const data = { ops, ref }
    each(options.includes, (type, name) => {
      data[name] =
        document[type.from || name] || queryOptions[type.from || name]
    })

    return document.patches.create(data)
  }

  schema.pre('save', function(next) {
    createPatch(this)
      .then(() => next())
      .catch(next)
  })

  schema.pre('findOneAndRemove', function(next) {
    if (!options.removePatches) {
      return next()
    }

    this.model
      .findOne(this._conditions)
      .then(original => deletePatches(original))
      .then(() => next())
      .catch(next)
  })

  schema.pre('findOneAndUpdate', preUpdateOne)

  function preUpdateOne(next) {
    this.model
      .findOne(this._conditions)
      .then(original => {
        original = original || new this.model({})
        this._original = toJSON(original.data())
      })
      .then(() => next())
      .catch(next)
  }

  schema.post('findOneAndUpdate', function(doc, next) {
    if (!this.options.new) {
      return postUpdateOne.call(this, {}, next)
    }

    doc._original = this._original
    createPatch(doc, this.options)
      .then(() => next())
      .catch(next)
  })

  function postUpdateOne(result, next) {
    if (result.nModified === 0) return

    const conditions = Object.assign(
      {},
      this._conditions,
      this._update.$set || this._update
    )

    this.model
      .findOne(conditions)
      .then(doc => {
        if (!doc) return next()
        doc._original = this._original
        return createPatch(doc, this.options)
      })
      .then(() => next())
      .catch(next)
  }

  schema.pre('updateOne', preUpdateOne)
  schema.post('updateOne', postUpdateOne)

  function preUpdateMany(next) {
    this.model
      .find(this._conditions)
      .then((originals = []) => {
        this._originals = []
          .concat(originals)
          .map(original => original || new this.model({}))
          .map(original => toJSON(original.data()))
      })
      .then(() => next())
      .catch(next)
  }

  function postUpdateMany(result, next) {
    if (result.nModified === 0) return

    const conditions = Object.assign(
      {},
      this._conditions,
      this._update.$set || this._update
    )

    this.model
      .find(conditions)
      .then(docs =>
        Promise.all(
          docs.map((doc, i) => {
            doc._original = this._originals[i]
            return createPatch(doc, this.options)
          })
        )
      )
      .then(() => next())
      .catch(next)
  }

  schema.pre('updateMany', preUpdateMany)
  schema.post('updateMany', postUpdateMany)

  schema.pre('update', function(next) {
    if (this.options.multi) {
      preUpdateMany.call(this, next)
    } else {
      preUpdateOne.call(this, next)
    }
  })
  schema.post('update', function(result, next) {
    if (this.options.many) {
      postUpdateMany.call(this, result, next)
    } else {
      postUpdateOne.call(this, result, next)
    }
  })
}
