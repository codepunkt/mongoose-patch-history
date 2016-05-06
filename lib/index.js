'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function (schema, opts) {
  var options = (0, _lodash.merge)({}, defaultOptions, opts);

  (0, _assert2.default)(options.mongoose, '`mongoose` option must be defined');
  (0, _assert2.default)(options.name, '`name` option must be defined');
  (0, _assert2.default)(!schema.methods.data, 'conflicting instance method: `data`');

  schema.methods.data = function () {
    return this.toObject({
      depopulate: true,
      versionKey: false,
      transform: function transform(doc, ret, options) {
        delete ret._id;
      }
    });
  };

  if (options.referenceUser) {
    schema.virtual('user').set(function (user) {
      this._user = user;
    });
  }

  // create patch model, enable static model access via `PatchModel` and
  // instance method access through an instances `patches` property
  var PatchModel = _model_factory2.default.patchModel(options);
  schema.statics.PatchModel = PatchModel;
  schema.virtual('patches').get(function () {
    return PatchModel;
  });

  // after a document is initialized or saved, fresh snapshots of the
  // documents data are created
  var snapshot = function snapshot() {
    this._original = this.data();
  };
  schema.post('init', snapshot);
  schema.post('save', snapshot);

  // when a document is removed, all patch documents from the associated
  // patch collection are also removed
  schema.pre('remove', function (next) {
    var ref = this._id;

    this.patches.find({ ref: ref }).then(function (patches) {
      return (0, _bluebird.join)(patches.map(function (patch) {
        return patch.remove();
      }));
    }).then(next).catch(next);
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

    var data = options.referenceUser ? { ops: ops, ref: ref, user: user } : { ops: ops, ref: ref };
    PatchModel.create(data).then(next).catch(next);
  });
};

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _fastJsonPatch = require('fast-json-patch');

var _lodash = require('lodash');

var _bluebird = require('bluebird');

var _model_factory = require('./model_factory');

var _model_factory2 = _interopRequireDefault(_model_factory);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// TODO transform options for model and collection name
var defaultOptions = {
  referenceUser: false
};