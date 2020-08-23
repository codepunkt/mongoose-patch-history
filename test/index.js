import assert from 'assert'
import { map, random } from 'lodash'
import Promise, { join } from 'bluebird'
import mongoose, { Schema } from 'mongoose'
import patchHistory, { RollbackError } from '../src'

mongoose.Promise = Promise
const ObjectId = mongoose.Types.ObjectId

const CommentSchema = new Schema({ text: String })
CommentSchema.virtual('user').set(function (user) {
  this._user = user
})
CommentSchema.plugin(patchHistory, {
  mongoose,
  name: 'commentPatches',
  removePatches: false,
  includes: {
    text: {
      type: String,
    },
    user: {
      type: Schema.Types.ObjectId,
      required: true,
      from: '_user',
    },
  },
})

const PostSchema = new Schema(
  {
    title: String,
    tags: { type: [String], default: void 0 },
  },
  { timestamps: true }
)
PostSchema.plugin(patchHistory, {
  mongoose,
  name: 'postPatches',
  transforms: [name => name.toLowerCase(), () => 'post_history'],
  includes: {
    version: { type: Number, from: '__v' },
    reason: { type: String, from: '__reason' },
    user: { type: Object, from: '__user' },
  },
})

PostSchema.virtual('user').set(function (user) {
  this.__user = user
})
PostSchema.virtual('reason').set(function (reason) {
  this.__reason = reason
})

const FruitSchema = new Schema({
  _id: { type: String, default: random(100).toString() },
  name: { type: String },
})
FruitSchema.plugin(patchHistory, { mongoose, name: 'fruitPatches' })

const ExcludeSchema = new Schema({
  name: { type: String },
  hidden: { type: String },
  object: { hiddenProperty: { type: String } },
  array: [{ hiddenProperty: { type: String }, property: { type: String } }],
})
ExcludeSchema.plugin(patchHistory, {
  mongoose,
  name: 'excludePatches',
  excludes: ['/hidden', '/object/hiddenProperty', '/array/*/hiddenProperty'],
})

const SportSchema = new Schema({
  _id: { type: Number, default: random(100) },
  name: { type: String },
})
SportSchema.plugin(patchHistory, { mongoose, name: 'sportPatches' })

const PricePoolSchema = new Schema({
  name: { type: String },
  prices: [{ name: { type: String }, value: { type: Number } }],
})
PricePoolSchema.plugin(patchHistory, { mongoose, name: 'pricePoolPatches' })

describe('mongoose-patch-history', () => {
  let Comment, Post, Fruit, Sport, User, PricePool, Exclude

  before(done => {
    Comment = mongoose.model('Comment', CommentSchema)
    Post = mongoose.model('Post', PostSchema)
    Fruit = mongoose.model('Fruit', FruitSchema)
    Sport = mongoose.model('Sport', SportSchema)
    User = mongoose.model('User', new Schema())
    PricePool = mongoose.model('PricePool', PricePoolSchema)
    Exclude = mongoose.model('Exclude', ExcludeSchema)

    mongoose
      .connect('mongodb://localhost/mongoose-patch-history', {
        useNewUrlParser: true,
        useCreateIndex: true,
        useUnifiedTopology: true,
        useFindAndModify: false,
      })
      .then(() => {
        join(
          Comment.deleteMany({}),
          Comment.Patches.deleteMany({}),
          Fruit.deleteMany({}),
          Fruit.Patches.deleteMany({}),
          Sport.deleteMany({}),
          Sport.Patches.deleteMany({}),
          Post.deleteMany({}),
          Post.Patches.deleteMany({}),
          User.deleteMany({}),
          PricePool.deleteMany({}),
          PricePool.Patches.deleteMany({}),
          Exclude.deleteMany({}),
          Exclude.Patches.deleteMany({})
        )
          .then(() => User.create())
          .then(() => done())
      })
  })

  after(() => mongoose.connection.close())

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
      assert.doesNotThrow(() =>
        TestSchema.plugin(patchHistory, {
          mongoose,
          name,
        })
      )
    })
  })

  describe('saving a new document', () => {
    it('adds a patch', done => {
      join(
        // without referenced user
        Post.create({ title: 'foo' })
          .then(post => post.patches.find({ ref: post.id }))
          .then(patches => {
            assert.equal(patches.length, 1)
            assert.equal(
              JSON.stringify(patches[0].ops),
              JSON.stringify([{ op: 'add', path: '/title', value: 'foo' }])
            )
          }),
        // with referenced user
        User.findOne()
          .then(user => Comment.create({ text: 'wat', user: ObjectId() }))
          .then(comment => comment.patches.find({ ref: comment.id }))
          .then(patches => {
            assert.equal(patches.length, 1)
            assert.equal(
              JSON.stringify(patches[0].ops),
              JSON.stringify([{ op: 'add', path: '/text', value: 'wat' }])
            )
          })
      )
        .then(() => done())
        .catch(done)
    })

    describe('with exclude options', () => {
      it('adds a patch containing no excluded properties', done => {
        Exclude.create({
          name: 'exclude1',
          hidden: 'hidden',
          object: { hiddenProperty: 'hidden' },
          array: [{ hiddenProperty: 'hidden', property: 'visible' }],
        })
          .then(exclude => exclude.patches.find({ ref: exclude._id }))
          .then(patches => {
            assert.equal(patches.length, 1)
            assert.equal(
              JSON.stringify(patches[0].ops),
              JSON.stringify([
                { op: 'add', path: '/name', value: 'exclude1' },
                { op: 'add', path: '/object', value: {} },
                { op: 'add', path: '/array', value: [{ property: 'visible' }] },
              ])
            )
          })
          .then(() => done())
          .catch(done)
      })
    })
  })

  describe('saving an existing document', () => {
    it('with changes: adds a patch', done => {
      Post.findOne({ title: 'foo' })
        .then(post => {
          post.set({
            title: 'bar',
            reason: 'test reason',
            user: { name: 'Joe' },
          })
          return post.save()
        })
        .then(post => post.patches.find({ ref: post.id }).sort({ _id: 1 }))
        .then(patches => {
          assert.equal(patches.length, 2)
          assert.equal(
            JSON.stringify(patches[1].ops),
            JSON.stringify([{ op: 'replace', path: '/title', value: 'bar' }])
          )
          assert.equal(patches[1].reason, 'test reason')
          assert.equal(patches[1].user.name, 'Joe')
        })
        .then(done)
        .catch(done)
    })

    it('without changes: doesn`t add a patch', done => {
      Post.create({ title: 'baz' })
        .then(post => post.save())
        .then(post => post.patches.find({ ref: post.id }))
        .then(patches => {
          assert.equal(patches.length, 1)
        })
        .then(done)
        .catch(done)
    })

    it('with changes covered by exclude: doesn`t add a patch', done => {
      Exclude.findOne({ name: 'exclude1' })
        .then(exclude => {
          exclude.object.hiddenProperty = 'test'
          exclude.array[0].hiddenProperty = 'test'
          return exclude.save()
        })
        .then(exclude => exclude.patches.find({ ref: exclude.id }))
        .then(patches => {
          assert.equal(patches.length, 1)
        })
        .then(() => done())
        .catch(done)
    })
  })

  describe('saving a document with custom _id type', () => {
    it('supports String _id types', done => {
      Fruit.create({ name: 'apple' })
        .then(fruit => fruit.patches.find({ ref: fruit._id }))
        .then(patches => {
          assert.equal(patches.length, 1)
          assert.equal(
            JSON.stringify(patches[0].ops),
            JSON.stringify([{ op: 'add', path: '/name', value: 'apple' }])
          )
        })
        .then(() => done())
        .catch(done)
    })
    it('supports Number _id types', done => {
      Sport.create({ name: 'golf' })
        .then(sport => sport.patches.find({ ref: sport._id }))
        .then(patches => {
          assert.equal(patches.length, 1)
          assert.equal(
            JSON.stringify(patches[0].ops),
            JSON.stringify([{ op: 'add', path: '/name', value: 'golf' }])
          )
        })
        .then(() => done())
        .catch(done)
    })
  })

  describe('updating a document via findOneAndUpdate()', () => {
    it('with changes: adds a patch', done => {
      Post.create({ title: 'findOneAndUpdate1' })
        .then(post =>
          Post.findOneAndUpdate(
            { _id: post._id },
            { title: 'findOneAndUpdate2', __v: 1 },
            { __reason: 'test reason', __user: { name: 'Joe' } }
          )
        )
        .then(post => post.patches.find({ ref: post._id }).sort({ _id: 1 }))
        .then(patches => {
          assert.equal(patches.length, 2)
          assert.equal(
            JSON.stringify(patches[1].ops),
            JSON.stringify([
              { op: 'replace', path: '/title', value: 'findOneAndUpdate2' },
            ])
          )
          assert.equal(patches[1].reason, 'test reason')
          assert.equal(patches[1].user.name, 'Joe')
        })
        .then(done)
        .catch(done)
    })

    it('without changes: doesn`t add a patch', done => {
      Post.findOneAndUpdate({ title: 'baz' }, {})
        .then(post => post.patches.find({ ref: post.id }))
        .then(patches => {
          assert.equal(patches.length, 1)
        })
        .then(done)
        .catch(done)
    })

    it('should not throw "TypeError: Cannot set property _original of null" error if doc does not exist', done => {
      Post.findOneAndUpdate(
        { title: 'the_answer_to_life' },
        { title: '42', comments: 'thanks for all the fish' }
      )
        .then(() => {
          done()
        })
        .catch(done)
    })
  })

  describe('updating a document via updateOne()', () => {
    it('with changes: adds a patch', done => {
      Post.create({ title: 'updateOne1' })
        .then(post =>
          Post.updateOne({ _id: post._id }, { title: 'updateOne2' })
        )
        .then(() => Post.findOne({ title: 'updateOne2' }))
        .then(post => post.patches.find({ ref: post._id }).sort({ _id: 1 }))
        .then(patches => {
          assert.equal(patches.length, 2)
          assert.equal(
            JSON.stringify(patches[1].ops),
            JSON.stringify([
              { op: 'replace', path: '/title', value: 'updateOne2' },
            ])
          )
        })
        .then(done)
        .catch(done)
    })

    it('without changes: doesn`t add a patch', done => {
      Post.updateOne({ title: 'baz' }, {})
        .then(() => Post.findOne({ title: 'baz' }))
        .then(post => post.patches.find({ ref: post.id }))
        .then(patches => {
          assert.equal(patches.length, 1)
        })
        .then(done)
        .catch(done)
    })

    it('handles array filters', done => {
      PricePool.create({
        name: 'test',
        prices: [
          { name: 'test1', value: 1 },
          { name: 'test2', value: 2 },
        ],
      })
        .then(pricePool =>
          PricePool.updateOne(
            { name: pricePool.name },
            { $set: { 'prices.$[elem].value': 3 } },
            { arrayFilters: [{ 'elem.name': { $eq: 'test1' } }] }
          )
        )
        .then(res => PricePool.Patches.find({}))
        .then(patches => {
          assert.equal(patches.length, 2)
        })
        .then(done)
        .catch(done)
    })
  })

  describe('updating a document via updateMany()', () => {
    it('with changes: adds a patch', done => {
      Post.create({ title: 'updateMany1' })
        .then(post =>
          Post.updateMany({ _id: post._id }, { title: 'updateMany2' })
        )
        .then(() => Post.find({ title: 'updateMany2' }))
        .then(posts =>
          posts[0].patches.find({ ref: posts[0]._id }).sort({ _id: 1 })
        )
        .then(patches => {
          assert.equal(patches.length, 2)
          assert.equal(
            JSON.stringify(patches[1].ops),
            JSON.stringify([
              { op: 'replace', path: '/title', value: 'updateMany2' },
            ])
          )
        })
        .then(done)
        .catch(done)
    })

    it('without changes: doesn`t add a patch', done => {
      Post.updateMany({ title: 'baz' }, {})
        .then(() => Post.find({ title: 'baz' }))
        .then(posts => posts[0].patches.find({ ref: posts[0].id }))
        .then(patches => {
          assert.equal(patches.length, 1)
        })
        .then(done)
        .catch(done)
    })

    it('handles the $push operator', done => {
      Post.create({ title: 'tagged1', tags: ['match'] })
        .then(post =>
          Post.updateMany(
            { _id: post._id },
            { $push: { tags: 'match2' } },
            { timestamps: false }
          )
        )
        .then(() => Post.find({ title: 'tagged1' }))
        .then(posts =>
          posts[0].patches.find({ ref: posts[0]._id }).sort({ _id: 1 })
        )
        .then(patches => {
          assert.equal(patches.length, 2)
          assert.equal(
            JSON.stringify(patches[1].ops),
            JSON.stringify([{ op: 'add', path: '/tags/1', value: 'match2' }])
          )
        })
        .then(() => done())
        .catch(done)
    })

    it('handles the $pull operator', done => {
      Post.create({ title: 'tagged2', tags: ['match'] })
        .then(post =>
          // Remove the 'match' tag from all posts tagged with 'match'
          Post.updateMany(
            { tags: 'match' },
            { $pull: { tags: 'match' } },
            { timestamps: false }
          )
        )
        .then(() => Post.find({ title: 'tagged2' }))
        .then(posts =>
          posts[0].patches.find({ ref: posts[0]._id }).sort({ _id: 1 })
        )
        .then(patches => {
          assert.equal(patches.length, 2)
          assert.equal(
            JSON.stringify(patches[1].ops),
            JSON.stringify([{ op: 'remove', path: '/tags/0' }])
          )
        })
        .then(() => done())
        .catch(done)
    })
  })

  describe('upserting a document', () => {
    it('with changes: adds a patch', done => {
      Post.update(
        { title: 'upsert0' },
        { title: 'upsert1' },
        { upsert: true, multi: true }
      )
        .then(() => Post.find({ title: 'upsert1' }))
        .then(posts =>
          posts[0].patches.find({ ref: posts[0]._id }).sort({ _id: 1 })
        )
        .then(patches => {
          assert.equal(patches.length, 1)
          assert.equal(
            JSON.stringify(patches[0].ops),
            JSON.stringify([{ op: 'add', path: '/title', value: 'upsert1' }])
          )
        })
        .then(done)
        .catch(done)
    })

    it('without changes: adds a patch', done => {
      Post.update(
        { title: 'upsert1' },
        { title: 'upsert1' },
        { upsert: true, multi: true }
      )
        .then(() => Post.find({ title: 'upsert1' }))
        .then(posts => posts[0].patches.find({ ref: posts[0].id }))
        .then(patches => {
          assert.equal(patches.length, 2)
        })
        .then(done)
        .catch(done)
    })

    it('with updateMany: adds a patch', done => {
      Post.updateMany(
        { title: 'upsert2' },
        { title: 'upsert3' },
        { upsert: true }
      )
        .then(() => Post.find({ title: 'upsert3' }))
        .then(posts => posts[0].patches.find({ ref: posts[0].id }))
        .then(patches => {
          assert.equal(patches.length, 1)
        })
        .then(done)
        .catch(done)
    })
  })

  describe('update with multi', () => {
    it('should not throw "TypeError: Cannot set property _original of null" error if doc does not exist', done => {
      Post.update(
        { title: { $in: ['foobar'] } },
        { title: 'barfoo' },
        { multi: true, upsert: false }
      )
        .then(() => done())
        .catch(done)
    })
  })

  describe('removing a document', () => {
    it('removes all patches', done => {
      Post.findOne({ title: 'bar' })
        .then(post => post.remove())
        .then(post => post.patches.find({ ref: post.id }))
        .then(patches => {
          assert.equal(patches.length, 0)
        })
        .then(done)
        .catch(done)
    })
    it("doesn't remove patches when `removePatches` is false", done => {
      Comment.findOne({ text: 'wat' })
        .then(comment => comment.remove())
        .then(comment => comment.patches.find({ ref: comment.id }))
        .then(patches => {
          assert.equal(patches.length, 1)
        })
        .then(done)
        .catch(done)
    })
    it('removes all patches via findOneAndRemove()', done => {
      Post.create({ title: 'findOneAndRemove1' })
        .then(post => Post.findOneAndRemove({ _id: post.id }))
        .then(post => post.patches.find({ ref: post.id }))
        .then(patches => {
          assert.equal(patches.length, 0)
        })
        .then(done)
        .catch(done)
    })
  })
  describe('rollback', () => {
    it('with unknown id is rejected', done => {
      Post.create({ title: 'version 1' }).then(post => {
        return post
          .rollback(ObjectId())
          .then(() => {
            done()
          })
          .catch(err => {
            assert(err instanceof RollbackError)
            done()
          })
      })
    })

    it('to latest patch is rejected', done => {
      Post.create({ title: 'version 1' })
        .then(post => join(post, post.patches.findOne({ ref: post.id })))
        .then(([post, latestPatch]) => {
          return post
            .rollback(latestPatch.id)
            .then(() => {
              done()
            })
            .catch(err => {
              assert(err instanceof RollbackError)
              done()
            })
        })
    })

    it('adds a new patch and updates the document', done => {
      Comment.create({ text: 'comm 1', user: ObjectId() })
        .then(c => Comment.findOne({ _id: c.id }))
        .then(c => c.set({ text: 'comm 2', user: ObjectId() }).save())
        .then(c => Comment.findOne({ _id: c.id }))
        .then(c => c.set({ text: 'comm 3', user: ObjectId() }).save())
        .then(c => Comment.findOne({ _id: c.id }))
        .then(c => join(c, c.patches.find({ ref: c.id })))
        .then(([c, patches]) => c.rollback(patches[1].id, { user: ObjectId() }))
        .then(c => {
          assert.equal(c.text, 'comm 2')
          return c.patches.find({ ref: c.id })
        })
        .then(patches => assert.equal(patches.length, 4))
        .then(done)
        .catch(done)
    })

    it("updates but doesn't save the document", done => {
      Comment.create({ text: 'comm 1', user: ObjectId() })
        .then(c => Comment.findOne({ _id: c.id }))
        .then(c => c.set({ text: 'comm 2', user: ObjectId() }).save())
        .then(c => Comment.findOne({ _id: c.id }))
        .then(c => c.set({ text: 'comm 3', user: ObjectId() }).save())
        .then(c => Comment.findOne({ _id: c.id }))
        .then(c => join(c, c.patches.find({ ref: c.id })))
        .then(([c, patches]) =>
          c.rollback(patches[1].id, { user: ObjectId() }, false)
        )
        .then(c => {
          assert.equal(c.text, 'comm 2')
          return Comment.findOne({ _id: c.id })
        })
        .then(c => {
          assert.equal(c.text, 'comm 3')
          return c.patches.find({ ref: c.id })
        })
        .then(patches => assert.equal(patches.length, 3))
        .then(done)
        .catch(done)
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

    it('pascalize for model and decamelize for collection', done => {
      join(
        () => assert(!!~mongoose.modelNames().indexOf('CommentPatches')),
        getCollectionNames().then(names => {
          assert(!!~names.indexOf('comment_patches'))
        })
      )
        .then(() => done())
        .catch(done)
    })

    it('uses `transform` option when set', done => {
      join(
        () => assert(!!~mongoose.modelNames().indexOf('postpatches')),
        getCollectionNames().then(names => {
          assert(!!~names.indexOf('post_history'))
        })
      )
        .then(() => done())
        .catch(done)
    })
  })

  describe('jsonpatch.compare', () => {
    let Organization
    let Person

    before(() => {
      Organization = mongoose.model(
        'Organization',
        new mongoose.Schema({
          name: String,
        })
      )

      const PersonSchema = new mongoose.Schema({
        name: String,
        organization: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Organization',
        },
      })

      PersonSchema.plugin(patchHistory, { mongoose, name: 'roomPatches' })
      Person = mongoose.model('Person', PersonSchema)
    })

    it('is able to handle ObjectId references correctly', done => {
      Organization.create({ text: 'Home' })
        .then(o1 => join(o1, Organization.create({ text: 'Work' })))
        .then(([o1, o2]) =>
          join(o1, o2, Person.create({ name: 'Bob', organization: o1._id }))
        )
        .then(([o1, o2, p]) =>
          join(o1, o2, p.set({ organization: o2._id }).save())
        )
        .then(([o1, o2, p]) => join(o1, o2, p.patches.find({ ref: p.id })))
        .then(([o1, o2, patches]) => {
          const pathFilter = path => elem => elem.path === path
          const firstOrganizationOperation = patches[0].ops.find(
            pathFilter('/organization')
          )
          const secondOrganizationOperation = patches[1].ops.find(
            pathFilter('/organization')
          )
          assert.equal(patches.length, 2)
          assert(firstOrganizationOperation)
          assert(secondOrganizationOperation)
          assert.equal(firstOrganizationOperation.value, o1._id.toString())
          assert.equal(secondOrganizationOperation.value, o2._id.toString())
        })
        .then(done)
        .catch(done)
    })
  })

  describe('track original values', () => {
    let Company

    before(() => {
      const CompanySchema = new mongoose.Schema({
        name: String,
      })

      CompanySchema.plugin(patchHistory, {
        mongoose,
        name: 'companyPatches',
        trackOriginalValue: true,
      })
      Company = mongoose.model('Company', CompanySchema)
    })

    after(done => {
      join(Company.remove(), Company.Patches.remove()).then(() => done())
    })

    it('stores the original value in the ops entries', done => {
      Company.create({ text: 'Private' })
        .then(c => c.set({ name: 'Private 2' }).save())
        .then(c => c.set({ name: 'Private 3' }).save())
        .then(c => c.patches.find())
        .then(patches => {
          assert.equal(patches.length, 2)
          assert.equal(
            JSON.stringify(patches[1].ops),
            JSON.stringify([
              {
                op: 'replace',
                path: '/name',
                value: 'Private 3',
                originalValue: 'Private 2',
              },
            ])
          )
        })
        .then(done)
        .catch(done)
    })
  })
})
