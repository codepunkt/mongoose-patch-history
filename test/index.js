import assert from 'assert'
import { map } from 'lodash'
import Promise, { join } from 'bluebird'
import mongoose, { Schema } from 'mongoose'
import patchHistory from '../src'

const CommentSchema = new Schema({ text: String })
CommentSchema.virtual('user').set(function (user) {
  this._user = user
})
CommentSchema.plugin(patchHistory, {
  mongoose,
  name: 'commentPatches',
  removePatches: false,
  includes: {
    user: {
      type: Schema.Types.ObjectId,
      required: true,
      from: '_user'
    }
  }
})

const PostSchema = new Schema({ title: String })
PostSchema.plugin(patchHistory, { mongoose,
  name: 'postPatches',
  transforms: [
    (name) => name.toLowerCase(),
    () => 'post_history'
  ]
})

describe('mongoose-patch-history', () => {
  let Comment, Post, User

  before((done) => {
    Comment = mongoose.model('Comment', CommentSchema)
    Post = mongoose.model('Post', PostSchema)
    User = mongoose.model('User', new Schema())

    mongoose.connect('mongodb://localhost/mongoose-patch-history', () => {
      join(
        Comment.remove(),
        Comment.PatchModel.remove(),
        Post.remove(),
        User.remove()
      )
      .then(() => User.create())
      .then(() => done())
    })
  })

  describe('initialization', () => {
    const name = 'testPatches'
    let TestSchema

    before(() => {
      TestSchema = new Schema()
    })

    it('throws when `mongoose` option is not defined', () => {
      assert.throws(() => TestSchema.plugin(patchHistory, { name }))
    })

    it('throws when `name` option is not defined', () => {
      assert.throws(() => TestSchema.plugin(patchHistory, { mongoose }))
    })

    it('throws when `data` instance method exists', () => {
      const DataSchema = new Schema()
      DataSchema.methods.data = () => {}
      assert.throws(() => DataSchema.plugin(patchHistory, { mongoose, name }))
    })

    it('does not throw with valid parameters', () => {
      assert.doesNotThrow(() => TestSchema.plugin(patchHistory, { mongoose, name }))
    })
  })

  describe('saving a new document', () => {
    it('adds a patch', (done) => {
      join(
        // without referenced user
        Post.create({ title: 'foo' })
          .then((post) => post.patches.find({ ref: post.id }))
          .then((patches) => {
            assert.equal(patches.length, 1)
            assert.deepEqual(patches[0].ops, [
              { value: 'foo', path: '/title', op: 'add' }
            ])
          }),
        // with referenced user
        User.findOne()
          .then((user) => Comment.create({ text: 'wat', user: mongoose.Types.ObjectId() }))
          .then((comment) => comment.patches.find({ ref: comment.id }))
          .then((patches) => {
            assert.equal(patches.length, 1)
            assert.deepEqual(patches[0].ops, [
              { value: 'wat', path: '/text', op: 'add' }
            ])
          })
      ).then(() => done()).catch(done)
    })
  })

  describe('saving an existing document', () => {
    it('with changes: adds a patch', (done) => {
      Post.findOne({ title: 'foo' })
        .then((post) => post.set({ title: 'bar' }).save())
        .then((post) => post.patches.find({ ref: post.id }).sort({ _id: 1 }))
        .then((patches) => {
          assert.equal(patches.length, 2)
          assert.deepEqual(patches[1].ops, [
            { value: 'bar', path: '/title', op: 'replace' }
          ])
        }).then(done).catch(done)
    })

    it('without changes: doesn`t add a patch', (done) => {
      Post.create({ title: 'baz' })
        .then((post) => post.save())
        .then((post) => post.patches.find({ ref: post.id }))
        .then((patches) => {
          assert.equal(patches.length, 1)
        }).then(done).catch(done)
    })
  })

  describe('removing a document', () => {
    it('removes all patches', (done) => {
      Post.findOne({ title: 'bar' })
        .then((post) => post.remove())
        .then((post) => post.patches.find({ ref: post.id }))
        .then((patches) => {
          assert.equal(patches.length, 0)
        }).then(done).catch(done)
    })
    it('doesn\'t remove patches when `removePatches` is false', (done) => {
      Comment.findOne({ text: 'wat' })
        .then((comment) => comment.remove())
        .then((comment) => comment.patches.find({ ref: comment.id }))
        .then((patches) => {
          assert.equal(patches.length, 1)
        }).then(done).catch(done)
    })
  })

  describe('model and collection names', () => {
    const getCollectionNames = () => {
      return new Promise((resolve, reject) => {
        mongoose.connection.db.listCollections().toArray((err, collections) => {
          if (err) return reject(err)
          resolve(map(collections, 'name'))
        })
      })
    }

    it('pascalize for model and decamelize for collection', (done) => {
      join(
        () => assert.ok(!!~mongoose.modelNames().indexOf('CommentPatches')),
        getCollectionNames().then((names) => {
          assert.ok(!!~names.indexOf('comment_patches'))
        })
      ).then(() => done()).catch(done)
    })

    it('uses `transform` option when set', (done) => {
      join(
        () => assert.ok(!!~mongoose.modelNames().indexOf('postpatches')),
        getCollectionNames().then((names) => {
          assert.ok(!!~names.indexOf('post_history'))
        })
      ).then(() => done()).catch(done)
    })
  })
})
