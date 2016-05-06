import assert from 'assert'
import { merge } from 'lodash'
import { join } from 'bluebird'
import { Schema } from 'mongoose'
import { compare } from 'fast-json-patch'
import { decamelize, pascalize } from 'humps'

// TODO transform options for model and collection name
const createPatchModel = (options) => {
  const def = {
    date: { type: Date, required: true, default: Date.now },
    ops: { type: [], required: true },
    ref: { type: Schema.Types.ObjectId, required: true, index: true },
    user: { type: Schema.Types.ObjectId, required: true }
  }

  if (!options.referenceUser) {
    delete def.user
  }

  const PatchSchema = new Schema(def)

  return options.mongoose.model(
    pascalize(`${options.name}`),
    PatchSchema,
    decamelize(`${options.name}`)
  )
}

const defaultOptions = {
  referenceUser: false
}

export default function (schema, opts) {
  const options = merge({}, defaultOptions, opts)

  // validate parameters
  assert(options.mongoose, '`mongoose` option must be defined')
  assert(options.name, '`name` option must be defined')
  assert(!schema.methods.data, 'conflicting instance method: `data`')

  // TODO comment
  if (options.referenceUser) {
    schema.virtual('user').set(function (user) {
      this._user = user
    })
  }

  // used to compare instance data snapshots. depopulates instance,
  // removes version key and object id
  schema.methods.data = function () {
    return this.toObject({
      depopulate: true,
      versionKey: false,
      transform: (doc, ret, options) => { delete ret._id }
    })
  }

  // create patch model, enable static model access via `PatchModel` and
  // instance method access through an instances `patches` property
  const PatchModel = createPatchModel(options)
  schema.statics.PatchModel = PatchModel
  schema.virtual('patches').get(() => PatchModel)

  // after a document is initialized or saved, fresh snapshots of the
  // documents data are created
  const snapshot = function () {
    this._original = this.data()
  }
  schema.post('init', snapshot)
  schema.post('save', snapshot)

  // when a document is removed, all patch documents from the associated
  // patch collection are also removed
  schema.pre('remove', function (next) {
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
    const { _id: ref, _user: user } = this
    const ops = compare(this.isNew ? {} : this._original, this.data())

    // except when there are no changes to save
    if (!ops.length) {
      return next()
    }

    const data = options.referenceUser ? { ops, ref, user } : { ops, ref }
    PatchModel.create(data).then(next).catch(next)
  })
}
