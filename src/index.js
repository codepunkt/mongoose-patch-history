import chalk from 'chalk'
import { Schema } from 'mongoose'
import { compare } from 'fast-json-patch'
import { decamelize, pascalize } from 'humps'
import { isPlainObject, merge } from 'lodash'

const defaultOptions = {
  debug: false,
  referenceUser: false,
  suffix: 'patches'
}

export default function (schema, options) {
  const check = (bool, message) => {
    if (!bool) throw new Error(message)
  }

  check(isPlainObject(options), 'options must be an object')
  check(options.mongoose, 'mongoose option must be defined')
  check(!schema.methods.data, 'conflicting instance method: `data`')
  check(!schema.methods.snapshot, 'conflicting instance method: `snapshot`')

  const opts = merge({}, defaultOptions, options)
  const mongoose = opts.mongoose

  schema.methods.data = function () {
    return this.toObject({
      depopulate: true,
      versionKey: false,
      transform: (doc, ret, options) => { delete ret._id }
    })
  }

  schema.methods.snapshot = function () {
    this._original = this.data()
    return this
  }

  if (opts.referenceUser) {
    schema.virtual('user').set(function (user) {
      this._user = user
    })
  }

  schema.virtual('patches').get(function () {
    const getName = (transform) => {
      return transform(`${this.constructor.modelName}_${opts.suffix}`)
    }
    const modelName = getName(pascalize)
    const collectionName = getName(decamelize)

    const schemaDef = {
      date: { type: Date, required: true, default: Date.now },
      ops: { type: [], required: true },
      ref: { type: Schema.Types.ObjectId, required: true }
    }
    if (opts.referenceUser) {
      schemaDef.user = { type: Schema.Types.ObjectId, required: true }
    }

    const PatchSchema = new Schema(schemaDef)

    PatchSchema.statics.log = (coll, method, query) => {
      const prefix = chalk.yellow.bold('mongoose-patch-history')
      console.log(`${prefix} ${coll}.${method}(${JSON.stringify(query)})`)
    }

    PatchSchema.pre('save', function (next) {
      if (opts.debug) {
        mongoose.set('debug', PatchSchema.log)
      }
      next()
    })

    PatchSchema.post('save', function () {
      if (opts.debug) {
        mongoose.set('debug', false)
      }
    })

    schema.statics.PatchModel = schema.statics.PatchModel ||
      mongoose.model(modelName, PatchSchema, collectionName)

    return schema.statics.PatchModel
  })

  // after a document is initialized or saved, fresh snapshots of the
  // documents data are created
  schema.post('init', function () {
    this.snapshot()
  })
  schema.post('save', function () {
    this.snapshot()
  })

  // when a document is removed, all patch documents from the associated
  // patch collection are also removed
  schema.pre('remove', function (next) {
    const { _id: ref } = this
    this.patches.remove({ ref }).then(next).catch(next)
  })

  // when a document is saved, the json patch that reflects the changes is
  // computed. if the patch consists of one or more operations (meaning the
  // document has changed), a new patch document reflecting the changes is
  // added to the associated patch collection
  schema.pre('save', function (next) {
    const { _id: ref, _user: user } = this
    const ops = compare(this.isNew ? {} : this._original, this.data())

    // except when there are no changes to save
    if (!ops.length) {
      return next()
    }

    const data = opts.referenceUser ? { ops, ref, user } : { ops, ref }
    this.patches.create(data).then(next).catch(next)
  })
}
