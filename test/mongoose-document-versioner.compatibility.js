import assert from 'assert'
import mongoose from 'mongoose'
import documentVersioner from '@syntropy/mongoose-document-versioner'
import patchHistory, { RollbackError } from '../src'

mongoose.Promise = Promise

const starshipSchema = new mongoose.Schema({
  name: String,
  class: String,
})

starshipSchema.plugin(documentVersioner)

starshipSchema.plugin(patchHistory, {
  mongoose,
  name: 'starship_history',
  includes: {
    version: { type: Number, from: 'version' }
  }
})

describe('mongoose-patch-history with mongoose-document-versioner', function () {
  let Starship2

  before((done) => {
    Starship2 = mongoose.model('Starship2', starshipSchema)

    mongoose.connect('mongodb://localhost:27017/mongoose-patch-history', { useNewUrlParser: true }, () => {
      Starship2.remove().then(() => done())
    })
  })

  after(() => mongoose.connection.close())

  it('bumps the version of a document with an updateMany query', function (done) {
    Promise.all([
      Starship2.create({ name: 'USS Archer', class: 'Enterprise' }),
      Starship2.create({ name: 'USS Huang Zhong', class: 'Enterprise' }),
      Starship2.create({ name: 'USS Sagittarius', class: 'Enterprise' })
    ])
      .then(function (ships) {
        ships.forEach(function (ship) {
          assert.equal(ship.version, 1)
        })
        return Starship2.updateMany({class: 'Enterprise'}, {class: 'Archer'})
          .then(function () {
            return Starship2.find({class: 'Archer'})
          })
      })
      .then(function (ships) {
        ships.forEach(function (ship) {
          assert.equal(ship.version, 2)
        })
        done()
      })
      .catch(done)
  })
})
