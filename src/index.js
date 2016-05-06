import assert from 'assert'
import { Schema } from 'mongoose'
import Promise, { join } from 'bluebird'
import jsonpatch from 'fast-json-patch'
import { decamelize, pascalize } from 'humps'
import { dropRightWhile, each, map, merge, omit } from 'lodash'

const createPatchModel = (options) => {
  const def = {
    date: { type: Date, required: true, default: Date.now },
    ops: { type: [], required: true },
    ref: { type: Schema.Types.ObjectId, required: true, index: true }
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
  removePatches: true,
  transforms: [ pascalize, decamelize ]
}

export default function (schema, opts) {
  const options = merge({}, defaultOptions, opts)

  // validate parameters
  assert(options.mongoose, '`mongoose` option must be defined')
  assert(options.name, '`name` option must be defined')
  assert(!schema.methods.data, 'conflicting instance method: `data`')

  // used to compare instance data snapshots. depopulates instance,
  // removes version key and object id
  schema.methods.data = function () {
    return this.toObject({
      depopulate: true,
      versionKey: false,
      // TODO don't filter out createdAt and updatedAt only, but create
      // a blacklist of properties that should be ignored while comparing
      transform: (doc, ret, options) => {
        delete ret._id
        delete ret.createdAt
        delete ret.updatedAt
      }
    })
  }

  // TODO comment this
  schema.methods.rollback = function (patchId) {
    return this.patches.find({ ref: this.id }).sort({ date: 1 }).exec()
      .then((patches) => new Promise((resolve, reject) => {
        const ids = map(patches, 'id')
        if (!~ids.indexOf(patchId)) return resolve()
        const apply = dropRightWhile(patches, (patch) => {
          return patch.id !== patchId
        })
        if (patches.length === apply.length) return resolve()
        const data = { user: apply[apply.length - 1].user }
        apply.forEach((patch) => {
          jsonpatch.apply(data, patch.ops, true)
        })
        console.log(data)
        this.set(data).save().then(resolve).catch(reject)
      }))
  }

  // create patch model, enable static model access via `Patches` and
  // instance method access through an instances `patches` property
  const Patches = createPatchModel(options)
  schema.statics.Patches = Patches
  schema.virtual('patches').get(() => Patches)

  // after a document is initialized or saved, fresh snapshots of the
  // documents data are created
  const snapshot = function () {
    this._original = this.data()
  }
  schema.post('init', snapshot)
  schema.post('save', snapshot)

  // when a document is removed and `removePatches` is not set to false ,
  // all patch documents from the associated patch collection are also removed
  schema.pre('remove', function (next) {
    if (!options.removePatches) {
      return next()
    }

    const { _id: ref } = this
    this.patches.find({ ref })
      .then((patches) => join(patches.map((patch) => patch.remove())))
      .then(next).catch(next)
  })

  // when a document is saved, the json patch that reflects the changes is
  // computed. if the patch consists of one or more operations (meaning the
  // document has changed), a new patch document reflecting the changes is
  // added to the associated patch collection
  schema.pre('save', function (next) {
    const { _id: ref } = this
    const ops = jsonpatch.compare(this.isNew ? {} : this._original, this.data())

    // don't save a patch when there are no changes to save
    if (!ops.length) {
      return next()
    }

    // assemble patch data
    const data = { ops, ref }
    each(options.includes, (type, name) => {
      data[name] = this[type.from || name]
    })

    this.patches.create(data).then(next).catch(next)
  })
}
