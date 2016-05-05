import assert from 'assert'
import { join } from 'bluebird'
import mongoose, { Schema } from 'mongoose'
import patchHistory from '../src'
import ModelFactory from './model_factory'
// import getCollectionNames from './get_collection_names'

describe('mongoose-patch-history', () => {
  const email = 'christoph@codepunkt.de'
  let Comment, Debug, Post, User

  before(() => {
    Comment = ModelFactory.create('Comment', {
      referenceUser: true,
      name: 'CommentHistory'
    })
    Debug = ModelFactory.create('Debug', {
      debug: true,
      name: 'DebugHistory'
    })
    Post = ModelFactory.create('Post', {
      name: 'PostHistory'
    })
    User = ModelFactory.create('User')
  })

  before((done) => {
    // mongoose.set('debug', true)
    mongoose.connect('mongodb://localhost/mongoose-patch-history', () => {
      join(Comment.remove(), Debug.remove(), Post.remove(), User.remove())
        .then(() => User.create({ prop: email }))
        .then(() => done())
    })
  })

  describe('initialization', () => {
    const name = 'History'
    let TestSchema

    before(() => {
      TestSchema = new Schema()
    })

    it('throws without options', () => {
      assert.throws(() => TestSchema.plugin(patchHistory))
    })

    it('throws when options is not an object', () => {
      assert.throws(() => TestSchema.plugin(patchHistory, []))
      assert.throws(() => TestSchema.plugin(patchHistory, 'string'))
      assert.throws(() => TestSchema.plugin(patchHistory, 42))
      assert.throws(() => TestSchema.plugin(patchHistory, true))
      assert.throws(() => TestSchema.plugin(patchHistory, null))
      assert.throws(() => TestSchema.plugin(patchHistory, NaN))
      assert.throws(() => TestSchema.plugin(patchHistory, () => {}))
    })

    it('throws when `mongoose` option is not defined', () => {
      assert.throws(() => TestSchema.plugin(patchHistory, { name }))
    })

    it('throws when `name` option is not defined', () => {
      assert.throws(() => TestSchema.plugin(patchHistory, { mongoose }))
    })

    it('throws when either `data` or `snapshot` instance methods exist', () => {
      const DataSchema = new Schema()
      DataSchema.methods.data = () => {}
      assert.throws(() => DataSchema.plugin(patchHistory, { mongoose, name }))
      const SnapshotSchema = new Schema()
      SnapshotSchema.methods.snapshot = () => {}
      assert.throws(() => SnapshotSchema.plugin(patchHistory, { mongoose, name }))
    })

    it('does not throw with valid parameters', () => {
      assert.doesNotThrow(() => TestSchema.plugin(patchHistory, { mongoose, name }))
    })
  })

  describe('saving a new document', () => {
    it('adds a patch', (done) => {
      join(
        // without referenced user
        Post.create({ prop: 'foo' })
          .then((post) => post.patches.find({ ref: post.id }))
          .then((patches) => {
            assert.equal(patches.length, 1)
            assert.deepEqual(patches[0].ops, [
              { value: 'foo', path: '/prop', op: 'add' }
            ])
          }),
        // with referenced user
        User.findOne({ prop: email })
          .then((user) => Comment.create({ prop: 'wat', user: user.id }))
          .then((comment) => comment.patches.find({ ref: comment.id }))
          .then((patches) => {
            assert.equal(patches.length, 1)
            assert.deepEqual(patches[0].ops, [
              { value: 'wat', path: '/prop', op: 'add' }
            ])
          })
      ).then(() => done()).catch(done)
    })
  })

  describe('saving an existing document', () => {
    it('with changes: adds a patch', (done) => {
      Post.findOne({ prop: 'foo' })
        .then((post) => post.set({ prop: 'bar' }).save())
        .then((post) => post.patches.find({ ref: post.id }))
        .then((patches) => {
          assert.equal(patches.length, 2)
          assert.deepEqual(patches[1].ops, [
            { value: 'bar', path: '/prop', op: 'replace' }
          ])
        }).then(done).catch(done)
    })

    it('without changes: doesn`t add a patch', (done) => {
      Post.create({ prop: 'baz' })
        .then((post) => post.save())
        .then((post) => post.patches.find({ ref: post.id }))
        .then((patches) => {
          assert.equal(patches.length, 1)
        }).then(done).catch(done)
    })
  })

  describe('removing a document', () => {
    it('also removes all patches', (done) => {
      Post.findOne({ prop: 'bar' })
        .then((post) => post.remove())
        .then((post) => post.patches.find({ ref: post.id }))
        .then((patches) => {
          assert.equal(patches.length, 0)
        }).then(done).catch(done)
    })
  })
})
