# Mongoose Patch History

[![npm version](https://badge.fury.io/js/mongoose-patch-history.svg)](https://badge.fury.io/js/mongoose-patch-history) [![Build Status](https://travis-ci.org/codepunkt/mongoose-patch-history.svg?branch=master)](https://travis-ci.org/codepunkt/mongoose-patch-history) [![Coverage Status](https://coveralls.io/repos/github/codepunkt/mongoose-patch-history/badge.svg?branch=master)](https://coveralls.io/github/codepunkt/mongoose-patch-history?branch=master)

Mongoose Patch History is a mongoose plugin that saves a history of [JSON Patch](http://jsonpatch.com/) operations for all documents belonging to a schema in an associated "patches" collection.

## Installation

    $ npm install mongoose-patch-history

## Usage
To use __mongoose-patch-history__ for an existing mongoose schema you can simply plug it in. As an example, the following schema definition defines a `Post` schema, and uses mongoose-patch-history with default options:

```javascript
import mongoose, { Schema } from 'mongoose'
import patchHistory from 'mongoose-patch-history'

const PostSchema = new Schema({
  title: { type: String, required: true },
  comments: Array
})

PostSchema.plugin(patchHistory, { mongoose, name: 'postPatches' })
const Post = mongoose.model('Post', PostSchema)
```

__mongoose-patch-history__ will define a schema that has a `ref` field containing the `ObjectId` of the original document, a `ops` array containing all json patch operations and a `date` field storing the date where the patch was applied.

### Storing a new document

Continuing the previous example, a new patch is added to the associated patch collection whenever a new post is added to the posts collection:

```javascript
Post.create({ title: 'JSON patches' })
  .then((post) => post.patches.findOne({ ref: post.id }))
  .then(console.log)

// {
//   _id: ObjectId('4edd40c86762e0fb12000003'),
//   ref: ObjectId('4edd40c86762e0fb12000004'),
//   ops: [
//     { value: 'JSON patches', path: '/title', op: 'add' },
//     { value: [], path: '/comments', op: 'add' }
//   ],
//   date: new Date(1462360838107),
//   __v: 0
// }
```

### Updating an existing document

__mongoose-patch-history__ also adds a static field `Patches` to the model that can be used to access the patch model associated with the model, for example to query all patches of a document. Whenever a post is edited, a new patch that reflects the update operation is added to the associated patch collection:

```javascript
const data = {
  title: 'JSON patches with mongoose',
  comments: [{ message: 'Wow! Such Mongoose! Very NoSQL!' }]
}

Post.create({ title: 'JSON patches' })
  .then((post) => post.set(data).save())
  .then((post) => post.patches.find({ ref: post.id }))
  .then(console.log)

// [{
//   _id: ObjectId('4edd40c86762e0fb12000003'),
//   ref: ObjectId('4edd40c86762e0fb12000004'),
//   ops: [
//     { value: 'JSON patches', path: '/title', op: 'add' },
//     { value: [], path: '/comments', op: 'add' }
//   ],
//   date: new Date(1462360838107),
//   __v: 0
// }, {
//   _id: ObjectId('4edd40c86762e0fb12000005'),
//   ref: ObjectId('4edd40c86762e0fb12000004'),
//   ops: [
//     { value: { message: 'Wow! Such Mongoose! Very NoSQL!' }, path: '/comments/0', op: 'add' },
//     { value: 'JSON patches with mongoose', path: '/title', op: 'replace' }
//   ],
//   "date": new Date(1462361848742),
//   "__v": 0
// }]
```

### Rollback to a specific patch

Documents have a `rollback` method that accepts the *ObjectId* of a patch doc and sets the document to the state of that patch, adding a new patch to the history.

```javascript
Post.create({ title: 'First version' })
  .then((post) => post.set({ title: 'Second version' }).save())
  .then((post) => post.set({ title: 'Third version' }).save())
  .then((post) => {
    return post.patches.find({ ref: post.id })
      .then((patches) => post.rollback(patches[1].id))
  })
  .then(console.log)

// {
//   _id: ObjectId('4edd40c86762e0fb12000006'),
//   title: 'Second version',
//   __v: 0
// }
```

The `rollback` method will throw an Error when invoked with an ObjectId that is
- not a patch of the document
- the latest patch of the document

## Options
```javascript
PostSchema.plugin(patchHistory, {
  mongoose,
  name: 'postPatches'
})
```

* `mongoose` :pushpin: *required* <br/>
The mongoose instance to work with
* `name` :pushpin: *required* <br/>
String where the names of both patch model and patch collection are generated from. By default, model name is the pascalized version and collection name is an undercore separated version
* `removePatches` <br/>
Removes patches when origin document is removed. Default: `true`
* `transforms` <br/>
An array of two functions that generate model and collection name based on the `name` option. Default: An array of [humps](https://github.com/domchristie/humps).pascalize and [humps](https://github.com/domchristie/humps).decamelize
* `includes` <br/>
Property definitions that will be included in the patch schema. Read more about includes in the next chapter of the documentation. Default: `{}`

### Includes
```javascript
PostSchema.plugin(patchHistory, {
  mongoose,
  name: 'postPatches',
  includes: {
    title: { type: String, required: true }
  }
})
```
This will add a `title` property to the patch schema. All options that are available in mongoose's schema property definitions such as `required`, `default` or `index` can be used.

```javascript
Post.create({ title: 'Included in every patch' })
  .then((post) => post.patches.findOne({ ref: post.id })
  .then((patch) => {
    console.log(patch.title) // 'Included in every patch'
  })
```

The value of the patch documents properties is read from the versioned documents property of the same name.

##### Reading from virtuals
There is an additional option that allows storing information in the patch documents that is not stored in the versioned documents. To do so, you can use a combination of [virtual type setters](http://mongoosejs.com/docs/guide.html#virtuals) on the versioned document and an additional `from` property in the include options of __mongoose-patch-history__:

```javascript
// save user as _user in versioned documents
PostSchema.virtual('user').set(function (user) {
  this._user = user
})

// read user from _user in patch documents
PostSchema.plugin(patchHistory, {
  mongoose,
  name: 'postPatches',
  includes: {
    user: { type: Schema.Types.ObjectId, required: true, from: '_user' }
  }
})

// create post, pass in user information
Post.create({
  title: 'Why is hiring broken?',
  user: mongoose.Types.ObjectId()
})
  .then((post) => {
    console.log(post.user) // undefined
    return post.patches.findOne({ ref: post.id })
  })
  .then((patch) => {
    console.log(patch.user) // 4edd40c86762e0fb12000012
  })
```

In case of a rollback in this scenario, the `rollback` method accepts an object as its second parameter where additional data can be injected:

```javascript
Post.create({ title: 'v1', user: mongoose.Types.ObjectId() })
  .then((post) => post.set({
    title: 'v2',
    user: mongoose.Types.ObjectId()
  }).save())
  .then((post) => {
    return post.patches.find({ ref: post.id })
      .then((patches) => post.rollback(patches[0].id, {
        user: mongoose.Types.ObjectId()
      }))
  })
```
