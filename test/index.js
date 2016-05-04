import assert from 'assert'
import { join } from 'bluebird'
import mongoose, { Schema } from 'mongoose'
import patchHistory from '../src'
import ModelFactory from './model_factory'
import getCollectionNames from './get_collection_names'

describe('mongoose-patch-history', () => {
  const email = 'christoph@codepunkt.de'
  let Comment, Debug, Post, Suffix, User

  before(() => {
    Comment = ModelFactory.create('Comment', { referenceUser: true })
    Debug = ModelFactory.create('Debug', { debug: true })
    Post = ModelFactory.create('Post', {})
    Suffix = ModelFactory.create('Suffix', { suffix: 'history' })
    User = ModelFactory.create('User')
  })

  before((done) => {
    // mongoose.set('debug', true)
    mongoose.connect('mongodb://localhost/mongoose-patch-history', () => {
      const emptyCollections = join(
        Comment.remove(), Debug.remove(), Post.remove(),
        Suffix.remove(), User.remove()
      )

      emptyCollections
        .then(() => User.create({ prop: email }))
        .then(() => done())
    })
  })

  describe('initialization', () => {
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

    it('throws when mongoose option is not defined', () => {
      assert.throws(() => TestSchema.plugin(patchHistory, {}))
    })

    it('throws when either `data` or `snapshot` instance methods exist', () => {
      const DataSchema = new Schema()
      DataSchema.methods.data = () => {}
      assert.throws(() => DataSchema.plugin(patchHistory, { mongoose }))
      const SnapshotSchema = new Schema()
      SnapshotSchema.methods.snapshot = () => {}
      assert.throws(() => SnapshotSchema.plugin(patchHistory, { mongoose }))
    })

    it('does not throw with valid parameters', () => {
      assert.doesNotThrow(() => TestSchema.plugin(patchHistory, { mongoose }))
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

  describe('naming', () => {
    it('suffix option adds suffix to both collection and model', (done) => {
      Suffix.create({ prop: 'qux' })
        .then((model) => getCollectionNames())
        .then((names) => {
          assert.ok(!!~mongoose.modelNames().indexOf('SuffixHistory'))
          assert.ok(!!~names.indexOf('suffix_history'))
        }).then(done).catch(done)
    })

    it('collection default is `${model}_patches`', (done) => {
      getCollectionNames().then((names) => {
        assert.ok(!!~names.indexOf('comment_patches'))
        assert.ok(!!~names.indexOf('post_patches'))
      }).then(done).catch(done)
    })

    it('model default is `${Model}History`', (done) => {
      const modelNames = mongoose.modelNames()
      assert.ok(!!~modelNames.indexOf('CommentPatches'))
      assert.ok(!!~modelNames.indexOf('PostPatches'))
      done()
    })
  })
})
