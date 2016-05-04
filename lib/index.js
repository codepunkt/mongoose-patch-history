'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function (schema, options) {
  var check = function check(bool, message) {
    if (!bool) throw new Error(message);
  };

  check((0, _lodash.isPlainObject)(options), 'options must be an object');
  check(options.mongoose, 'mongoose option must be defined');
  check(!schema.methods.data, 'conflicting instance method: `data`');
  check(!schema.methods.snapshot, 'conflicting instance method: `snapshot`');

  var opts = (0, _lodash.merge)({}, defaultOptions, options);
  var mongoose = opts.mongoose;

  schema.methods.data = function () {
    return this.toObject({
      depopulate: true,
      versionKey: false,
      transform: function transform(doc, ret, options) {
        delete ret._id;
      }
    });
  };

  schema.methods.snapshot = function () {
    this._original = this.data();
    return this;
  };

  if (opts.referenceUser) {
    schema.virtual('user').set(function (user) {
      this._user = user;
    });
  }

  schema.virtual('patches').get(function () {
    var _this = this;

    var getName = function getName(transform) {
      return transform(_this.constructor.modelName + '_' + opts.suffix);
    };
    var modelName = getName(_humps.pascalize);
    var collectionName = getName(_humps.decamelize);

    var schemaDef = {
      date: { type: Date, required: true, default: Date.now },
      ops: { type: [], required: true },
      ref: { type: _mongoose.Schema.Types.ObjectId, required: true }
    };
    if (opts.referenceUser) {
      schemaDef.user = { type: _mongoose.Schema.Types.ObjectId, required: true };
    }

    var PatchSchema = new _mongoose.Schema(schemaDef);

    PatchSchema.statics.log = function (coll, method, query) {
      var prefix = _chalk2.default.yellow.bold('mongoose-patch-history');
      console.log(prefix + ' ' + coll + '.' + method + '(' + JSON.stringify(query) + ')');
    };

    PatchSchema.pre('save', function (next) {
      if (opts.debug) {
        mongoose.set('debug', PatchSchema.log);
      }
      next();
    });

    PatchSchema.post('save', function () {
      if (opts.debug) {
        mongoose.set('debug', false);
      }
    });

    schema.statics.PatchModel = schema.statics.PatchModel || mongoose.model(modelName, PatchSchema, collectionName);

    return schema.statics.PatchModel;
  });

  // after a document is initialized or saved, fresh snapshots of the
  // documents data are created
  schema.post('init', function () {
    this.snapshot();
  });
  schema.post('save', function () {
    this.snapshot();
  });

  // when a document is removed, all patch documents from the associated
  // patch collection are also removed
  schema.pre('remove', function (next) {
    var ref = this._id;

    this.patches.remove({ ref: ref }).then(next).catch(next);
  });

  // when a document is saved, the json patch that reflects the changes is
  // computed. if the patch consists of one or more operations (meaning the
  // document has changed), a new patch document reflecting the changes is
  // added to the associated patch collection
  schema.pre('save', function (next) {
    var ref = this._id;
    var user = this._user;

    var ops = (0, _fastJsonPatch.compare)(this.isNew ? {} : this._original, this.data());

    // except when there are no changes to save
    if (!ops.length) {
      return next();
    }

    var data = opts.referenceUser ? { ops: ops, ref: ref, user: user } : { ops: ops, ref: ref };
    this.patches.create(data).then(next).catch(next);
  });
};

var _chalk = require('chalk');

var _chalk2 = _interopRequireDefault(_chalk);

var _mongoose = require('mongoose');

var _fastJsonPatch = require('fast-json-patch');

var _humps = require('humps');

var _lodash = require('lodash');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var defaultOptions = {
  debug: false,
  referenceUser: false,
  suffix: 'patches'
};