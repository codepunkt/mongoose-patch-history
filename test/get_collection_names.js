import { map } from 'lodash'
import Promise from 'bluebird'
import mongoose from 'mongoose'

export default () => {
  return new Promise((resolve, reject) => {
    mongoose.connection.db.listCollections().toArray((err, collections) => {
      if (err) return reject(err)
      resolve(map(collections, 'name'))
    })
  })
}
