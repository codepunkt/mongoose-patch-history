# Mongoose Patch History

[![npm version](https://badge.fury.io/js/mongoose-patch-history.svg)](https://badge.fury.io/js/mongoose-patch-history) [![Build Status](https://travis-ci.org/gonsfx/mongoose-patch-history.svg?branch=master)](https://travis-ci.org/gonsfx/mongoose-patch-history) [![Coverage Status](https://coveralls.io/repos/github/gonsfx/mongoose-patch-history/badge.svg?branch=master)](https://coveralls.io/github/gonsfx/mongoose-patch-history?branch=master) [![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg)](http://standardjs.com/)

Mongoose Patch History is a mongoose plugin that saves a history of [JSON Patch](http://jsonpatch.com/) operations for all documents belonging to a schema in an associated "patches" collection.

## Installation

    $ npm install mongoose-patch-history

## Usage
To use __mongoose-patch-history__ for an existing mongoose schema you can simply plug it in. As an example, the following schema definition defines a `Post` schema, and uses mongoose-patch-history with default options:

```javascript
import mongoose, { Schema } from 'mongoose'
import patchHistory from 'mongoose-patch-history'

const PostSchema = new Schema({
  title: { type: String, required: true }
});

PostSchema.plugin(patchHistory, { mongoose })
const Post = mongoose.model('Post', PostSchema)
```

__mongoose-patch-history__ will define a schema that has a `ref` field containing the `ObjectId` of the original document, a `operations` array containing all json patch operations and a `date` field storing the date where the patch was applied.

### Storing a new document

Continuing the previous example, a new patch is added to the associated patch collection whenever a new post is added to the posts collection:

```javascript
const post = await Post.create({ title: 'JSON patches' })
const patch = await post.patches.findOne({ ref: post.id })

console.log(patch)

// {
//   _id: ObjectId('4edd40c86762e0fb12000003'),
//   ref: ObjectId('4edd40c86762e0fb12000004'),
//   operations: [
//     { value: 'JSON patches', path: '/title', op: 'add' },
//     { value: [], path: '/comments', op: 'add' }
//   ],
//   date: new Date(1462360838107),
//   __v: 0
// }
```

### Updating an existing document

__mongoose-patch-history__ also adds a static field `PatchModel` to the model that can be used to access the patch model associated with the model, for example to query all patches of a document. Whenever a post is edited, a new patch that reflects the update operation is added to the associated patch collection:

```javascript
const data = {
  title: 'JSON patches with mongoose',
  comments: [{ message: 'Wow! Such Mongoose! Very NoSQL!' }]
}

await post.set(data).save()
const patches = await Post.PatchModel.find({ ref: post.id })

console.log(patches)

// [{
//   _id: ObjectId('4edd40c86762e0fb12000003'),
//   ref: ObjectId('4edd40c86762e0fb12000004'),
//   operations: [
//     { value: 'JSON patches', path: '/title', op: 'add' },
//     { value: [], path: '/comments', op: 'add' }
//   ],
//   date: new Date(1462360838107),
//   __v: 0
// }, {
//   _id: ObjectId('4edd40c86762e0fb12000005'),
//   ref: ObjectId('4edd40c86762e0fb12000004'),
//   operations: [
//     { value: { message: 'Wow! Such Mongoose! Very NoSQL!' }, path: '/comments/0', op: 'add' },
//     { value: 'JSON patches with mongoose', path: '/title', op: 'replace' }
//   ],
//   "date": new Date(1462361848742),
//   "__v": 0
// }]
```
