'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function (schema, options) {
  var check = function check(bool, message) {
    if (!bool) throw new Error(message);
  };

  check((0, _lodash.isPlainObject)(options), 'options must be an object');
  check(options.connection, 'connection option must be defined');
  check(!schema.methods.data, 'conflicting instance method: `data`');
  check(!schema.methods.snapshot, 'conflicting instance method: `snapshot`');

  var defaults = {
    referenceUser: false,
    suffix: 'patches'
  };
  var opts = (0, _lodash.merge)({}, defaults, options);

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
      operations: { type: [], required: true },
      ref: { type: _mongoose.Schema.Types.ObjectId, required: true }
    };
    if (opts.referenceUser) {
      schemaDef.user = { type: _mongoose.Schema.Types.ObjectId, required: true };
    }

    schema.statics.PatchModel = schema.statics.PatchModel || opts.connection.model(modelName, new _mongoose.Schema(schemaDef), collectionName);

    return schema.statics.PatchModel;
  });

  // snapshot after both init and save
  schema.post('init', function () {
    this.snapshot();
  });
  schema.post('save', function () {
    this.snapshot();
  });

  // remove all patch entries when removing a document
  schema.pre('remove', function (next) {
    var ref = this._id;

    this.patches.remove({ ref: ref }).then(function () {
      return next();
    }).catch(next);
  });

  // store a patch when saving a document...
  schema.pre('save', function (next) {
    var ref = this._id;
    var user = this._user;

    var operations = _fastJsonPatch2.default.compare(this.isNew ? {} : this._original, this.data());

    // ...except when it doesn't have any changes
    if (!operations.length) {
      return next();
    }

    var data = opts.referenceUser ? { operations: operations, ref: ref, user: user } : { operations: operations, ref: ref };

    this.patches.create(data).then(function () {
      return next();
    }).catch(next);
  });
};

var _mongoose = require('mongoose');

var _humps = require('humps');

var _fastJsonPatch = require('fast-json-patch');

var _fastJsonPatch2 = _interopRequireDefault(_fastJsonPatch);

var _lodash = require('lodash');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }