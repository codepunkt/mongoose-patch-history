import mongoose, { Schema } from 'mongoose'
import { isPlainObject, merge } from 'lodash'
import patchHistory from '../src'

export default {
  create (name, options = false) {
    const S = new Schema({
      prop: { type: String, required: true }
    })

    if (isPlainObject(options)) {
      S.plugin(patchHistory, merge({ mongoose }, options))
    }

    return mongoose.model(name, S)
  }
}
