'use strict';

var _slicedToArray = (function() {
  function sliceIterator(arr, i) {
    var _arr = [];
    var _n = true;
    var _d = false;
    var _e = undefined;
    try {
      for (
        var _i = arr[Symbol.iterator](), _s;
        !(_n = (_s = _i.next()).done);
        _n = true
      ) {
        _arr.push(_s.value);
        if (i && _arr.length === i) break;
      }
    } catch (err) {
      _d = true;
      _e = err;
    } finally {
      try {
        if (!_n && _i['return']) _i['return']();
      } finally {
        if (_d) throw _e;
      }
    }
    return _arr;
  }
  return function(arr, i) {
    if (Array.isArray(arr)) {
      return arr;
    } else if (Symbol.iterator in Object(arr)) {
      return sliceIterator(arr, i);
    } else {
      throw new TypeError(
        'Invalid attempt to destructure non-iterable instance'
      );
    }
  };
})();

function _asyncToGenerator(fn) {
  return function() {
    var gen = fn.apply(this, arguments);
    return new Promise(function(resolve, reject) {
      function step(key, arg) {
        try {
          var info = gen[key](arg);
          var value = info.value;
        } catch (error) {
          reject(error);
          return;
        }
        if (info.done) {
          resolve(value);
        } else {
          return Promise.resolve(value).then(
            function(value) {
              step('next', value);
            },
            function(err) {
              step('throw', err);
            }
          );
        }
      }
      return step('next');
    });
  };
}

const fs = require('fs');
const path = require('path');
const debug = require('debug')('email-templates');
const htmlToText = require('html-to-text');
const I18N = require('@ladjs/i18n');
const autoBind = require('auto-bind');
const nodemailer = require('nodemailer');
const consolidate = require('consolidate');
const previewEmail = require('preview-email');
const _ = require('lodash');
const Promise = require('bluebird');

const getPaths = require('get-paths');
const juiceResources = require('juice-resources-promise');

const env = process.env.NODE_ENV || 'development';
const stat = Promise.promisify(fs.stat);
const readFile = Promise.promisify(fs.readFile);

class Email {
  constructor(config = {}) {
    debug('config passed %O', config);

    // 2.x backwards compatible support
    if (config.juiceOptions) {
      config.juiceResources = config.juiceOptions;
      delete config.juiceOptions;
    }
    if (config.disableJuice) {
      config.juice = false;
      delete config.disableJuice;
    }
    if (config.render) {
      config.customRender = true;
    }

    this.config = _.merge(
      {
        views: {
          // directory where email templates reside
          root: path.resolve('emails'),
          options: {
            // default file extension for template
            extension: 'pug',
            map: {
              hbs: 'handlebars',
              njk: 'nunjucks'
            },
            engineSource: consolidate
          },
          // locals to pass to templates for rendering
          locals: {
            // pretty is automatically set to `false` for subject/text
            pretty: true
          }
        },
        // <https://nodemailer.com/message/>
        message: {},
        send: !['development', 'test'].includes(env),
        preview: env === 'development',
        // <https://github.com/ladjs/i18n>
        // set to an object to configure and enable it
        i18n: false,
        // pass a custom render function if necessary
        render: this.render.bind(this),
        customRender: false,
        // force text-only rendering of template (disregards template folder)
        textOnly: false,
        // <https://github.com/werk85/node-html-to-text>
        htmlToText: {
          ignoreImage: true
        },
        subjectPrefix: false,
        // <https://github.com/Automattic/juice>
        juice: true,
        juiceResources: {
          preserveImportant: true,
          webResources: {
            relativeTo: path.resolve('build'),
            images: false
          }
        },
        // pass a transport configuration object or a transport instance
        // (e.g. an instance is created via `nodemailer.createTransport`)
        // <https://nodemailer.com/transports/>
        transport: {}
      },
      config
    );

    // override existing method
    this.render = this.config.render;

    if (!_.isFunction(this.config.transport.sendMail))
      this.config.transport = nodemailer.createTransport(this.config.transport);

    debug('transformed config %O', this.config);

    autoBind(this);
  }

  // shorthand use of `juiceResources` with the config
  // (mainly for custom renders like from a database)
  juiceResources(html) {
    return juiceResources(html, this.config.juiceResources);
  }

  // a simple helper function that gets the actual file path for the template
  getTemplatePath(view) {
    var _this = this;

    return _asyncToGenerator(function*() {
      const paths = yield getPaths(
        _this.config.views.root,
        view,
        _this.config.views.options.extension
      );
      const filePath = path.resolve(_this.config.views.root, paths.rel);
      return { filePath, paths };
    })();
  }

  // returns true or false if a template exists
  // (uses same look-up approach as `render` function)
  templateExists(view) {
    var _this2 = this;

    return _asyncToGenerator(function*() {
      try {
        var _ref = yield _this2.getTemplatePath(view);

        const filePath = _ref.filePath;

        const stats = yield stat(filePath);
        if (!stats.isFile()) throw new Error(`${filePath} was not a file`);
        return true;
      } catch (err) {
        debug('templateExists', err);
        return false;
      }
    })();
  }

  // promise version of consolidate's render
  // inspired by koa-views and re-uses the same config
  // <https://github.com/queckezz/koa-views>
  render(view, locals = {}) {
    var _this3 = this;

    return _asyncToGenerator(function*() {
      var _config$views$options = _this3.config.views.options;
      const map = _config$views$options.map,
        engineSource = _config$views$options.engineSource;

      var _ref2 = yield _this3.getTemplatePath(view);

      const filePath = _ref2.filePath,
        paths = _ref2.paths;

      if (paths.ext === 'html' && !map) {
        const res = yield readFile(filePath, 'utf8');
        return res;
      }
      const engineName = map && map[paths.ext] ? map[paths.ext] : paths.ext;
      const renderFn = engineSource[engineName];
      if (!engineName || !renderFn)
        throw new Error(
          `Engine not found for the ".${paths.ext}" file extension`
        );

      if (_.isObject(_this3.config.i18n)) {
        const i18n = new I18N(
          Object.assign({}, _this3.config.i18n, {
            register: locals
          })
        );

        // support `locals.user.last_locale`
        // (e.g. for <https://lad.js.org>)
        if (_.isObject(locals.user) && _.isString(locals.user.last_locale))
          locals.locale = locals.user.last_locale;

        if (_.isString(locals.locale)) i18n.setLocale(locals.locale);
      }

      const res = yield Promise.promisify(renderFn)(filePath, locals);
      // transform the html with juice using remote paths
      // google now supports media queries
      // https://developers.google.com/gmail/design/reference/supported_css
      if (!_this3.config.juice) return res;
      const html = yield _this3.juiceResources(res);
      return html;
    })();
  }

  renderAll(template, locals = {}, message = {}) {
    var _this4 = this;

    return _asyncToGenerator(function*() {
      let subjectTemplateExists = _this4.config.customRender;
      let htmlTemplateExists = _this4.config.customRender;
      let textTemplateExists = _this4.config.customRender;

      const promises = [
        _this4.templateExists(`${template}/subject`),
        _this4.templateExists(`${template}/html`),
        _this4.templateExists(`${template}/text`)
      ];

      if (template && !_this4.config.customRender) {
        var _ref3 = yield Promise.all(promises);

        var _ref4 = _slicedToArray(_ref3, 3);

        subjectTemplateExists = _ref4[0];
        htmlTemplateExists = _ref4[1];
        textTemplateExists = _ref4[2];
      }
      if (!message.subject && subjectTemplateExists) {
        message.subject = yield _this4.render(
          `${template}/subject`,
          Object.assign({}, locals, { pretty: false })
        );
        message.subject = message.subject.trim();
      }

      if (message.subject && _this4.config.subjectPrefix)
        message.subject = _this4.config.subjectPrefix + message.subject;

      if (!message.html && htmlTemplateExists)
        message.html = yield _this4.render(`${template}/html`, locals);

      if (!message.text && textTemplateExists)
        message.text = yield _this4.render(
          `${template}/text`,
          Object.assign({}, locals, { pretty: false })
        );

      if (_this4.config.htmlToText && message.html && !message.text)
        // we'd use nodemailer-html-to-text plugin
        // but we really don't need to support cid
        // <https://github.com/andris9/nodemailer-html-to-text>
        message.text = htmlToText.fromString(
          message.html,
          _this4.config.htmlToText
        );

      // if we only want a text-based version of the email
      if (_this4.config.textOnly) delete message.html;

      return message;
    })();
  }

  send(options = {}) {
    var _this5 = this;

    return _asyncToGenerator(function*() {
      options = Object.assign(
        {
          template: '',
          message: {},
          locals: {}
        },
        options
      );

      var _options = options;
      let template = _options.template,
        message = _options.message,
        locals = _options.locals;

      const attachments =
        message.attachments || _this5.config.message.attachments || [];

      message = _.defaultsDeep(
        {},
        _.omit(message, 'attachments'),
        _.omit(_this5.config.message, 'attachments')
      );
      locals = _.defaultsDeep({}, _this5.config.views.locals, locals);

      if (attachments) message.attachments = attachments;

      debug('template %s', template);
      debug('message %O', message);
      debug('locals (keys only): %O', Object.keys(locals));

      // get all available templates
      const obj = yield _this5.renderAll(template, locals, message);

      // assign the object variables over to the message
      Object.assign(message, obj);

      if (_this5.config.preview) {
        debug('using `preview-email` to preview email');
        yield previewEmail(message);
      }

      if (!_this5.config.send) {
        debug('send disabled so we are ensuring JSONTransport');
        // <https://github.com/nodemailer/nodemailer/issues/798>
        // if (this.config.transport.name !== 'JSONTransport')
        _this5.config.transport = nodemailer.createTransport({
          jsonTransport: true
        });
      }

      const res = yield _this5.config.transport.sendMail(message);
      debug('message sent');
      res.originalMessage = message;
      return res;
    })();
  }
}

module.exports = Email;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9pbmRleC5qcyJdLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwiZGVidWciLCJodG1sVG9UZXh0IiwiSTE4TiIsImF1dG9CaW5kIiwibm9kZW1haWxlciIsImNvbnNvbGlkYXRlIiwicHJldmlld0VtYWlsIiwiXyIsIlByb21pc2UiLCJnZXRQYXRocyIsImp1aWNlUmVzb3VyY2VzIiwiZW52IiwicHJvY2VzcyIsIk5PREVfRU5WIiwic3RhdCIsInByb21pc2lmeSIsInJlYWRGaWxlIiwiRW1haWwiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImp1aWNlT3B0aW9ucyIsImRpc2FibGVKdWljZSIsImp1aWNlIiwicmVuZGVyIiwiY3VzdG9tUmVuZGVyIiwibWVyZ2UiLCJ2aWV3cyIsInJvb3QiLCJyZXNvbHZlIiwib3B0aW9ucyIsImV4dGVuc2lvbiIsIm1hcCIsImhicyIsIm5qayIsImVuZ2luZVNvdXJjZSIsImxvY2FscyIsInByZXR0eSIsIm1lc3NhZ2UiLCJzZW5kIiwiaW5jbHVkZXMiLCJwcmV2aWV3IiwiaTE4biIsImJpbmQiLCJ0ZXh0T25seSIsImlnbm9yZUltYWdlIiwic3ViamVjdFByZWZpeCIsInByZXNlcnZlSW1wb3J0YW50Iiwid2ViUmVzb3VyY2VzIiwicmVsYXRpdmVUbyIsImltYWdlcyIsInRyYW5zcG9ydCIsImlzRnVuY3Rpb24iLCJzZW5kTWFpbCIsImNyZWF0ZVRyYW5zcG9ydCIsImh0bWwiLCJnZXRUZW1wbGF0ZVBhdGgiLCJ2aWV3IiwicGF0aHMiLCJmaWxlUGF0aCIsInJlbCIsInRlbXBsYXRlRXhpc3RzIiwic3RhdHMiLCJpc0ZpbGUiLCJFcnJvciIsImVyciIsImV4dCIsInJlcyIsImVuZ2luZU5hbWUiLCJyZW5kZXJGbiIsImlzT2JqZWN0IiwiT2JqZWN0IiwiYXNzaWduIiwicmVnaXN0ZXIiLCJ1c2VyIiwiaXNTdHJpbmciLCJsYXN0X2xvY2FsZSIsImxvY2FsZSIsInNldExvY2FsZSIsInJlbmRlckFsbCIsInRlbXBsYXRlIiwic3ViamVjdFRlbXBsYXRlRXhpc3RzIiwiaHRtbFRlbXBsYXRlRXhpc3RzIiwidGV4dFRlbXBsYXRlRXhpc3RzIiwicHJvbWlzZXMiLCJhbGwiLCJzdWJqZWN0IiwidHJpbSIsInRleHQiLCJmcm9tU3RyaW5nIiwiYXR0YWNobWVudHMiLCJkZWZhdWx0c0RlZXAiLCJvbWl0Iiwia2V5cyIsIm9iaiIsImpzb25UcmFuc3BvcnQiLCJvcmlnaW5hbE1lc3NhZ2UiLCJtb2R1bGUiLCJleHBvcnRzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxNQUFNQSxLQUFLQyxRQUFRLElBQVIsQ0FBWDtBQUNBLE1BQU1DLE9BQU9ELFFBQVEsTUFBUixDQUFiO0FBQ0EsTUFBTUUsUUFBUUYsUUFBUSxPQUFSLEVBQWlCLGlCQUFqQixDQUFkO0FBQ0EsTUFBTUcsYUFBYUgsUUFBUSxjQUFSLENBQW5CO0FBQ0EsTUFBTUksT0FBT0osUUFBUSxhQUFSLENBQWI7QUFDQSxNQUFNSyxXQUFXTCxRQUFRLFdBQVIsQ0FBakI7QUFDQSxNQUFNTSxhQUFhTixRQUFRLFlBQVIsQ0FBbkI7QUFDQSxNQUFNTyxjQUFjUCxRQUFRLGFBQVIsQ0FBcEI7QUFDQSxNQUFNUSxlQUFlUixRQUFRLGVBQVIsQ0FBckI7QUFDQSxNQUFNUyxJQUFJVCxRQUFRLFFBQVIsQ0FBVjtBQUNBLE1BQU1VLFVBQVVWLFFBQVEsVUFBUixDQUFoQjs7QUFFQSxNQUFNVyxXQUFXWCxRQUFRLFdBQVIsQ0FBakI7QUFDQSxNQUFNWSxpQkFBaUJaLFFBQVEseUJBQVIsQ0FBdkI7O0FBRUEsTUFBTWEsTUFBTUMsUUFBUUQsR0FBUixDQUFZRSxRQUFaLElBQXdCLGFBQXBDO0FBQ0EsTUFBTUMsT0FBT04sUUFBUU8sU0FBUixDQUFrQmxCLEdBQUdpQixJQUFyQixDQUFiO0FBQ0EsTUFBTUUsV0FBV1IsUUFBUU8sU0FBUixDQUFrQmxCLEdBQUdtQixRQUFyQixDQUFqQjs7QUFFQSxNQUFNQyxLQUFOLENBQVk7QUFDVkMsY0FBWUMsU0FBUyxFQUFyQixFQUF5QjtBQUN2Qm5CLFVBQU0sa0JBQU4sRUFBMEJtQixNQUExQjs7QUFFQTtBQUNBLFFBQUlBLE9BQU9DLFlBQVgsRUFBeUI7QUFDdkJELGFBQU9ULGNBQVAsR0FBd0JTLE9BQU9DLFlBQS9CO0FBQ0EsYUFBT0QsT0FBT0MsWUFBZDtBQUNEO0FBQ0QsUUFBSUQsT0FBT0UsWUFBWCxFQUF5QjtBQUN2QkYsYUFBT0csS0FBUCxHQUFlLEtBQWY7QUFDQSxhQUFPSCxPQUFPRSxZQUFkO0FBQ0Q7QUFDRCxRQUFJRixPQUFPSSxNQUFYLEVBQW1CO0FBQ2pCSixhQUFPSyxZQUFQLEdBQXNCLElBQXRCO0FBQ0Q7O0FBRUQsU0FBS0wsTUFBTCxHQUFjWixFQUFFa0IsS0FBRixDQUNaO0FBQ0VDLGFBQU87QUFDTDtBQUNBQyxjQUFNNUIsS0FBSzZCLE9BQUwsQ0FBYSxRQUFiLENBRkQ7QUFHTEMsaUJBQVM7QUFDUDtBQUNBQyxxQkFBVyxLQUZKO0FBR1BDLGVBQUs7QUFDSEMsaUJBQUssWUFERjtBQUVIQyxpQkFBSztBQUZGLFdBSEU7QUFPUEMsd0JBQWM3QjtBQVBQLFNBSEo7QUFZTDtBQUNBOEIsZ0JBQVE7QUFDTjtBQUNBQyxrQkFBUTtBQUZGO0FBYkgsT0FEVDtBQW1CRTtBQUNBQyxlQUFTLEVBcEJYO0FBcUJFQyxZQUFNLENBQUMsQ0FBQyxhQUFELEVBQWdCLE1BQWhCLEVBQXdCQyxRQUF4QixDQUFpQzVCLEdBQWpDLENBckJUO0FBc0JFNkIsZUFBUzdCLFFBQVEsYUF0Qm5CO0FBdUJFO0FBQ0E7QUFDQThCLFlBQU0sS0F6QlI7QUEwQkU7QUFDQWxCLGNBQVEsS0FBS0EsTUFBTCxDQUFZbUIsSUFBWixDQUFpQixJQUFqQixDQTNCVjtBQTRCRWxCLG9CQUFjLEtBNUJoQjtBQTZCRTtBQUNBbUIsZ0JBQVUsS0E5Qlo7QUErQkU7QUFDQTFDLGtCQUFZO0FBQ1YyQyxxQkFBYTtBQURILE9BaENkO0FBbUNFQyxxQkFBZSxLQW5DakI7QUFvQ0U7QUFDQXZCLGFBQU8sSUFyQ1Q7QUFzQ0VaLHNCQUFnQjtBQUNkb0MsMkJBQW1CLElBREw7QUFFZEMsc0JBQWM7QUFDWkMsc0JBQVlqRCxLQUFLNkIsT0FBTCxDQUFhLE9BQWIsQ0FEQTtBQUVacUIsa0JBQVE7QUFGSTtBQUZBLE9BdENsQjtBQTZDRTtBQUNBO0FBQ0E7QUFDQUMsaUJBQVc7QUFoRGIsS0FEWSxFQW1EWi9CLE1BbkRZLENBQWQ7O0FBc0RBO0FBQ0EsU0FBS0ksTUFBTCxHQUFjLEtBQUtKLE1BQUwsQ0FBWUksTUFBMUI7O0FBRUEsUUFBSSxDQUFDaEIsRUFBRTRDLFVBQUYsQ0FBYSxLQUFLaEMsTUFBTCxDQUFZK0IsU0FBWixDQUFzQkUsUUFBbkMsQ0FBTCxFQUNFLEtBQUtqQyxNQUFMLENBQVkrQixTQUFaLEdBQXdCOUMsV0FBV2lELGVBQVgsQ0FBMkIsS0FBS2xDLE1BQUwsQ0FBWStCLFNBQXZDLENBQXhCOztBQUVGbEQsVUFBTSx1QkFBTixFQUErQixLQUFLbUIsTUFBcEM7O0FBRUFoQixhQUFTLElBQVQ7QUFDRDs7QUFFRDtBQUNBO0FBQ0FPLGlCQUFlNEMsSUFBZixFQUFxQjtBQUNuQixXQUFPNUMsZUFBZTRDLElBQWYsRUFBcUIsS0FBS25DLE1BQUwsQ0FBWVQsY0FBakMsQ0FBUDtBQUNEOztBQUVEO0FBQ002QyxpQkFBTixDQUFzQkMsSUFBdEIsRUFBNEI7QUFBQTs7QUFBQTtBQUMxQixZQUFNQyxRQUFRLE1BQU1oRCxTQUNsQixNQUFLVSxNQUFMLENBQVlPLEtBQVosQ0FBa0JDLElBREEsRUFFbEI2QixJQUZrQixFQUdsQixNQUFLckMsTUFBTCxDQUFZTyxLQUFaLENBQWtCRyxPQUFsQixDQUEwQkMsU0FIUixDQUFwQjtBQUtBLFlBQU00QixXQUFXM0QsS0FBSzZCLE9BQUwsQ0FBYSxNQUFLVCxNQUFMLENBQVlPLEtBQVosQ0FBa0JDLElBQS9CLEVBQXFDOEIsTUFBTUUsR0FBM0MsQ0FBakI7QUFDQSxhQUFPLEVBQUVELFFBQUYsRUFBWUQsS0FBWixFQUFQO0FBUDBCO0FBUTNCOztBQUVEO0FBQ0E7QUFDTUcsZ0JBQU4sQ0FBcUJKLElBQXJCLEVBQTJCO0FBQUE7O0FBQUE7QUFDekIsVUFBSTtBQUFBLG1CQUNtQixNQUFNLE9BQUtELGVBQUwsQ0FBcUJDLElBQXJCLENBRHpCOztBQUFBLGNBQ01FLFFBRE4sUUFDTUEsUUFETjs7QUFFRixjQUFNRyxRQUFRLE1BQU0vQyxLQUFLNEMsUUFBTCxDQUFwQjtBQUNBLFlBQUksQ0FBQ0csTUFBTUMsTUFBTixFQUFMLEVBQXFCLE1BQU0sSUFBSUMsS0FBSixDQUFXLEdBQUVMLFFBQVMsaUJBQXRCLENBQU47QUFDckIsZUFBTyxJQUFQO0FBQ0QsT0FMRCxDQUtFLE9BQU9NLEdBQVAsRUFBWTtBQUNaaEUsY0FBTSxnQkFBTixFQUF3QmdFLEdBQXhCO0FBQ0EsZUFBTyxLQUFQO0FBQ0Q7QUFUd0I7QUFVMUI7O0FBRUQ7QUFDQTtBQUNBO0FBQ016QyxRQUFOLENBQWFpQyxJQUFiLEVBQW1CckIsU0FBUyxFQUE1QixFQUFnQztBQUFBOztBQUFBO0FBQUEsa0NBQ0EsT0FBS2hCLE1BQUwsQ0FBWU8sS0FBWixDQUFrQkcsT0FEbEI7QUFBQSxZQUN0QkUsR0FEc0IseUJBQ3RCQSxHQURzQjtBQUFBLFlBQ2pCRyxZQURpQix5QkFDakJBLFlBRGlCOztBQUFBLGtCQUVGLE1BQU0sT0FBS3FCLGVBQUwsQ0FBcUJDLElBQXJCLENBRko7O0FBQUEsWUFFdEJFLFFBRnNCLFNBRXRCQSxRQUZzQjtBQUFBLFlBRVpELEtBRlksU0FFWkEsS0FGWTs7QUFHOUIsVUFBSUEsTUFBTVEsR0FBTixLQUFjLE1BQWQsSUFBd0IsQ0FBQ2xDLEdBQTdCLEVBQWtDO0FBQ2hDLGNBQU1tQyxNQUFNLE1BQU1sRCxTQUFTMEMsUUFBVCxFQUFtQixNQUFuQixDQUFsQjtBQUNBLGVBQU9RLEdBQVA7QUFDRDtBQUNELFlBQU1DLGFBQWFwQyxPQUFPQSxJQUFJMEIsTUFBTVEsR0FBVixDQUFQLEdBQXdCbEMsSUFBSTBCLE1BQU1RLEdBQVYsQ0FBeEIsR0FBeUNSLE1BQU1RLEdBQWxFO0FBQ0EsWUFBTUcsV0FBV2xDLGFBQWFpQyxVQUFiLENBQWpCO0FBQ0EsVUFBSSxDQUFDQSxVQUFELElBQWUsQ0FBQ0MsUUFBcEIsRUFDRSxNQUFNLElBQUlMLEtBQUosQ0FDSCw4QkFBNkJOLE1BQU1RLEdBQUksa0JBRHBDLENBQU47O0FBSUYsVUFBSTFELEVBQUU4RCxRQUFGLENBQVcsT0FBS2xELE1BQUwsQ0FBWXNCLElBQXZCLENBQUosRUFBa0M7QUFDaEMsY0FBTUEsT0FBTyxJQUFJdkMsSUFBSixDQUNYb0UsT0FBT0MsTUFBUCxDQUFjLEVBQWQsRUFBa0IsT0FBS3BELE1BQUwsQ0FBWXNCLElBQTlCLEVBQW9DO0FBQ2xDK0Isb0JBQVVyQztBQUR3QixTQUFwQyxDQURXLENBQWI7O0FBTUE7QUFDQTtBQUNBLFlBQUk1QixFQUFFOEQsUUFBRixDQUFXbEMsT0FBT3NDLElBQWxCLEtBQTJCbEUsRUFBRW1FLFFBQUYsQ0FBV3ZDLE9BQU9zQyxJQUFQLENBQVlFLFdBQXZCLENBQS9CLEVBQ0V4QyxPQUFPeUMsTUFBUCxHQUFnQnpDLE9BQU9zQyxJQUFQLENBQVlFLFdBQTVCOztBQUVGLFlBQUlwRSxFQUFFbUUsUUFBRixDQUFXdkMsT0FBT3lDLE1BQWxCLENBQUosRUFBK0JuQyxLQUFLb0MsU0FBTCxDQUFlMUMsT0FBT3lDLE1BQXRCO0FBQ2hDOztBQUVELFlBQU1WLE1BQU0sTUFBTTFELFFBQVFPLFNBQVIsQ0FBa0JxRCxRQUFsQixFQUE0QlYsUUFBNUIsRUFBc0N2QixNQUF0QyxDQUFsQjtBQUNBO0FBQ0E7QUFDQTtBQUNBLFVBQUksQ0FBQyxPQUFLaEIsTUFBTCxDQUFZRyxLQUFqQixFQUF3QixPQUFPNEMsR0FBUDtBQUN4QixZQUFNWixPQUFPLE1BQU0sT0FBSzVDLGNBQUwsQ0FBb0J3RCxHQUFwQixDQUFuQjtBQUNBLGFBQU9aLElBQVA7QUFuQzhCO0FBb0MvQjs7QUFFS3dCLFdBQU4sQ0FBZ0JDLFFBQWhCLEVBQTBCNUMsU0FBUyxFQUFuQyxFQUF1Q0UsVUFBVSxFQUFqRCxFQUFxRDtBQUFBOztBQUFBO0FBQ25ELFVBQUkyQyx3QkFBd0IsT0FBSzdELE1BQUwsQ0FBWUssWUFBeEM7QUFDQSxVQUFJeUQscUJBQXFCLE9BQUs5RCxNQUFMLENBQVlLLFlBQXJDO0FBQ0EsVUFBSTBELHFCQUFxQixPQUFLL0QsTUFBTCxDQUFZSyxZQUFyQzs7QUFFQSxZQUFNMkQsV0FBVyxDQUNmLE9BQUt2QixjQUFMLENBQXFCLEdBQUVtQixRQUFTLFVBQWhDLENBRGUsRUFFZixPQUFLbkIsY0FBTCxDQUFxQixHQUFFbUIsUUFBUyxPQUFoQyxDQUZlLEVBR2YsT0FBS25CLGNBQUwsQ0FBcUIsR0FBRW1CLFFBQVMsT0FBaEMsQ0FIZSxDQUFqQjs7QUFNQSxVQUFJQSxZQUFZLENBQUMsT0FBSzVELE1BQUwsQ0FBWUssWUFBN0I7QUFDRTs7QUFERixvQkFLTSxNQUFNaEIsUUFBUTRFLEdBQVIsQ0FBWUQsUUFBWixDQUxaOztBQUFBOztBQUVJSCw2QkFGSjtBQUdJQywwQkFISjtBQUlJQywwQkFKSjtBQUFBLE9BT0EsSUFBSSxDQUFDN0MsUUFBUWdELE9BQVQsSUFBb0JMLHFCQUF4QixFQUErQztBQUM3QzNDLGdCQUFRZ0QsT0FBUixHQUFrQixNQUFNLE9BQUs5RCxNQUFMLENBQ3JCLEdBQUV3RCxRQUFTLFVBRFUsRUFFdEJULE9BQU9DLE1BQVAsQ0FBYyxFQUFkLEVBQWtCcEMsTUFBbEIsRUFBMEIsRUFBRUMsUUFBUSxLQUFWLEVBQTFCLENBRnNCLENBQXhCO0FBSUFDLGdCQUFRZ0QsT0FBUixHQUFrQmhELFFBQVFnRCxPQUFSLENBQWdCQyxJQUFoQixFQUFsQjtBQUNEOztBQUVELFVBQUlqRCxRQUFRZ0QsT0FBUixJQUFtQixPQUFLbEUsTUFBTCxDQUFZMEIsYUFBbkMsRUFDRVIsUUFBUWdELE9BQVIsR0FBa0IsT0FBS2xFLE1BQUwsQ0FBWTBCLGFBQVosR0FBNEJSLFFBQVFnRCxPQUF0RDs7QUFFRixVQUFJLENBQUNoRCxRQUFRaUIsSUFBVCxJQUFpQjJCLGtCQUFyQixFQUNFNUMsUUFBUWlCLElBQVIsR0FBZSxNQUFNLE9BQUsvQixNQUFMLENBQWEsR0FBRXdELFFBQVMsT0FBeEIsRUFBZ0M1QyxNQUFoQyxDQUFyQjs7QUFFRixVQUFJLENBQUNFLFFBQVFrRCxJQUFULElBQWlCTCxrQkFBckIsRUFDRTdDLFFBQVFrRCxJQUFSLEdBQWUsTUFBTSxPQUFLaEUsTUFBTCxDQUNsQixHQUFFd0QsUUFBUyxPQURPLEVBRW5CVCxPQUFPQyxNQUFQLENBQWMsRUFBZCxFQUFrQnBDLE1BQWxCLEVBQTBCLEVBQUVDLFFBQVEsS0FBVixFQUExQixDQUZtQixDQUFyQjs7QUFLRixVQUFJLE9BQUtqQixNQUFMLENBQVlsQixVQUFaLElBQTBCb0MsUUFBUWlCLElBQWxDLElBQTBDLENBQUNqQixRQUFRa0QsSUFBdkQ7QUFDRTtBQUNBO0FBQ0E7QUFDQWxELGdCQUFRa0QsSUFBUixHQUFldEYsV0FBV3VGLFVBQVgsQ0FDYm5ELFFBQVFpQixJQURLLEVBRWIsT0FBS25DLE1BQUwsQ0FBWWxCLFVBRkMsQ0FBZjs7QUFLRjtBQUNBLFVBQUksT0FBS2tCLE1BQUwsQ0FBWXdCLFFBQWhCLEVBQTBCLE9BQU9OLFFBQVFpQixJQUFmOztBQUUxQixhQUFPakIsT0FBUDtBQWxEbUQ7QUFtRHBEOztBQUVLQyxNQUFOLENBQVdULFVBQVUsRUFBckIsRUFBeUI7QUFBQTs7QUFBQTtBQUN2QkEsZ0JBQVV5QyxPQUFPQyxNQUFQLENBQ1I7QUFDRVEsa0JBQVUsRUFEWjtBQUVFMUMsaUJBQVMsRUFGWDtBQUdFRixnQkFBUTtBQUhWLE9BRFEsRUFNUk4sT0FOUSxDQUFWOztBQUR1QixxQkFVYUEsT0FWYjtBQUFBLFVBVWpCa0QsUUFWaUIsWUFVakJBLFFBVmlCO0FBQUEsVUFVUDFDLE9BVk8sWUFVUEEsT0FWTztBQUFBLFVBVUVGLE1BVkYsWUFVRUEsTUFWRjs7O0FBWXZCLFlBQU1zRCxjQUNKcEQsUUFBUW9ELFdBQVIsSUFBdUIsT0FBS3RFLE1BQUwsQ0FBWWtCLE9BQVosQ0FBb0JvRCxXQUEzQyxJQUEwRCxFQUQ1RDs7QUFHQXBELGdCQUFVOUIsRUFBRW1GLFlBQUYsQ0FDUixFQURRLEVBRVJuRixFQUFFb0YsSUFBRixDQUFPdEQsT0FBUCxFQUFnQixhQUFoQixDQUZRLEVBR1I5QixFQUFFb0YsSUFBRixDQUFPLE9BQUt4RSxNQUFMLENBQVlrQixPQUFuQixFQUE0QixhQUE1QixDQUhRLENBQVY7QUFLQUYsZUFBUzVCLEVBQUVtRixZQUFGLENBQWUsRUFBZixFQUFtQixPQUFLdkUsTUFBTCxDQUFZTyxLQUFaLENBQWtCUyxNQUFyQyxFQUE2Q0EsTUFBN0MsQ0FBVDs7QUFFQSxVQUFJc0QsV0FBSixFQUFpQnBELFFBQVFvRCxXQUFSLEdBQXNCQSxXQUF0Qjs7QUFFakJ6RixZQUFNLGFBQU4sRUFBcUIrRSxRQUFyQjtBQUNBL0UsWUFBTSxZQUFOLEVBQW9CcUMsT0FBcEI7QUFDQXJDLFlBQU0sd0JBQU4sRUFBZ0NzRSxPQUFPc0IsSUFBUCxDQUFZekQsTUFBWixDQUFoQzs7QUFFQTtBQUNBLFlBQU0wRCxNQUFNLE1BQU0sT0FBS2YsU0FBTCxDQUFlQyxRQUFmLEVBQXlCNUMsTUFBekIsRUFBaUNFLE9BQWpDLENBQWxCOztBQUVBO0FBQ0FpQyxhQUFPQyxNQUFQLENBQWNsQyxPQUFkLEVBQXVCd0QsR0FBdkI7O0FBRUEsVUFBSSxPQUFLMUUsTUFBTCxDQUFZcUIsT0FBaEIsRUFBeUI7QUFDdkJ4QyxjQUFNLHdDQUFOO0FBQ0EsY0FBTU0sYUFBYStCLE9BQWIsQ0FBTjtBQUNEOztBQUVELFVBQUksQ0FBQyxPQUFLbEIsTUFBTCxDQUFZbUIsSUFBakIsRUFBdUI7QUFDckJ0QyxjQUFNLGdEQUFOO0FBQ0E7QUFDQTtBQUNBLGVBQUttQixNQUFMLENBQVkrQixTQUFaLEdBQXdCOUMsV0FBV2lELGVBQVgsQ0FBMkI7QUFDakR5Qyx5QkFBZTtBQURrQyxTQUEzQixDQUF4QjtBQUdEOztBQUVELFlBQU01QixNQUFNLE1BQU0sT0FBSy9DLE1BQUwsQ0FBWStCLFNBQVosQ0FBc0JFLFFBQXRCLENBQStCZixPQUEvQixDQUFsQjtBQUNBckMsWUFBTSxjQUFOO0FBQ0FrRSxVQUFJNkIsZUFBSixHQUFzQjFELE9BQXRCO0FBQ0EsYUFBTzZCLEdBQVA7QUFuRHVCO0FBb0R4QjtBQW5RUzs7QUFzUVo4QixPQUFPQyxPQUFQLEdBQWlCaEYsS0FBakIiLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzQ29udGVudCI6WyJjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xuY29uc3QgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCdlbWFpbC10ZW1wbGF0ZXMnKTtcbmNvbnN0IGh0bWxUb1RleHQgPSByZXF1aXJlKCdodG1sLXRvLXRleHQnKTtcbmNvbnN0IEkxOE4gPSByZXF1aXJlKCdAbGFkanMvaTE4bicpO1xuY29uc3QgYXV0b0JpbmQgPSByZXF1aXJlKCdhdXRvLWJpbmQnKTtcbmNvbnN0IG5vZGVtYWlsZXIgPSByZXF1aXJlKCdub2RlbWFpbGVyJyk7XG5jb25zdCBjb25zb2xpZGF0ZSA9IHJlcXVpcmUoJ2NvbnNvbGlkYXRlJyk7XG5jb25zdCBwcmV2aWV3RW1haWwgPSByZXF1aXJlKCdwcmV2aWV3LWVtYWlsJyk7XG5jb25zdCBfID0gcmVxdWlyZSgnbG9kYXNoJyk7XG5jb25zdCBQcm9taXNlID0gcmVxdWlyZSgnYmx1ZWJpcmQnKTtcblxuY29uc3QgZ2V0UGF0aHMgPSByZXF1aXJlKCdnZXQtcGF0aHMnKTtcbmNvbnN0IGp1aWNlUmVzb3VyY2VzID0gcmVxdWlyZSgnanVpY2UtcmVzb3VyY2VzLXByb21pc2UnKTtcblxuY29uc3QgZW52ID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ2RldmVsb3BtZW50JztcbmNvbnN0IHN0YXQgPSBQcm9taXNlLnByb21pc2lmeShmcy5zdGF0KTtcbmNvbnN0IHJlYWRGaWxlID0gUHJvbWlzZS5wcm9taXNpZnkoZnMucmVhZEZpbGUpO1xuXG5jbGFzcyBFbWFpbCB7XG4gIGNvbnN0cnVjdG9yKGNvbmZpZyA9IHt9KSB7XG4gICAgZGVidWcoJ2NvbmZpZyBwYXNzZWQgJU8nLCBjb25maWcpO1xuXG4gICAgLy8gMi54IGJhY2t3YXJkcyBjb21wYXRpYmxlIHN1cHBvcnRcbiAgICBpZiAoY29uZmlnLmp1aWNlT3B0aW9ucykge1xuICAgICAgY29uZmlnLmp1aWNlUmVzb3VyY2VzID0gY29uZmlnLmp1aWNlT3B0aW9ucztcbiAgICAgIGRlbGV0ZSBjb25maWcuanVpY2VPcHRpb25zO1xuICAgIH1cbiAgICBpZiAoY29uZmlnLmRpc2FibGVKdWljZSkge1xuICAgICAgY29uZmlnLmp1aWNlID0gZmFsc2U7XG4gICAgICBkZWxldGUgY29uZmlnLmRpc2FibGVKdWljZTtcbiAgICB9XG4gICAgaWYgKGNvbmZpZy5yZW5kZXIpIHtcbiAgICAgIGNvbmZpZy5jdXN0b21SZW5kZXIgPSB0cnVlO1xuICAgIH1cblxuICAgIHRoaXMuY29uZmlnID0gXy5tZXJnZShcbiAgICAgIHtcbiAgICAgICAgdmlld3M6IHtcbiAgICAgICAgICAvLyBkaXJlY3Rvcnkgd2hlcmUgZW1haWwgdGVtcGxhdGVzIHJlc2lkZVxuICAgICAgICAgIHJvb3Q6IHBhdGgucmVzb2x2ZSgnZW1haWxzJyksXG4gICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgLy8gZGVmYXVsdCBmaWxlIGV4dGVuc2lvbiBmb3IgdGVtcGxhdGVcbiAgICAgICAgICAgIGV4dGVuc2lvbjogJ3B1ZycsXG4gICAgICAgICAgICBtYXA6IHtcbiAgICAgICAgICAgICAgaGJzOiAnaGFuZGxlYmFycycsXG4gICAgICAgICAgICAgIG5qazogJ251bmp1Y2tzJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGVuZ2luZVNvdXJjZTogY29uc29saWRhdGVcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vIGxvY2FscyB0byBwYXNzIHRvIHRlbXBsYXRlcyBmb3IgcmVuZGVyaW5nXG4gICAgICAgICAgbG9jYWxzOiB7XG4gICAgICAgICAgICAvLyBwcmV0dHkgaXMgYXV0b21hdGljYWxseSBzZXQgdG8gYGZhbHNlYCBmb3Igc3ViamVjdC90ZXh0XG4gICAgICAgICAgICBwcmV0dHk6IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8vIDxodHRwczovL25vZGVtYWlsZXIuY29tL21lc3NhZ2UvPlxuICAgICAgICBtZXNzYWdlOiB7fSxcbiAgICAgICAgc2VuZDogIVsnZGV2ZWxvcG1lbnQnLCAndGVzdCddLmluY2x1ZGVzKGVudiksXG4gICAgICAgIHByZXZpZXc6IGVudiA9PT0gJ2RldmVsb3BtZW50JyxcbiAgICAgICAgLy8gPGh0dHBzOi8vZ2l0aHViLmNvbS9sYWRqcy9pMThuPlxuICAgICAgICAvLyBzZXQgdG8gYW4gb2JqZWN0IHRvIGNvbmZpZ3VyZSBhbmQgZW5hYmxlIGl0XG4gICAgICAgIGkxOG46IGZhbHNlLFxuICAgICAgICAvLyBwYXNzIGEgY3VzdG9tIHJlbmRlciBmdW5jdGlvbiBpZiBuZWNlc3NhcnlcbiAgICAgICAgcmVuZGVyOiB0aGlzLnJlbmRlci5iaW5kKHRoaXMpLFxuICAgICAgICBjdXN0b21SZW5kZXI6IGZhbHNlLFxuICAgICAgICAvLyBmb3JjZSB0ZXh0LW9ubHkgcmVuZGVyaW5nIG9mIHRlbXBsYXRlIChkaXNyZWdhcmRzIHRlbXBsYXRlIGZvbGRlcilcbiAgICAgICAgdGV4dE9ubHk6IGZhbHNlLFxuICAgICAgICAvLyA8aHR0cHM6Ly9naXRodWIuY29tL3dlcms4NS9ub2RlLWh0bWwtdG8tdGV4dD5cbiAgICAgICAgaHRtbFRvVGV4dDoge1xuICAgICAgICAgIGlnbm9yZUltYWdlOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIHN1YmplY3RQcmVmaXg6IGZhbHNlLFxuICAgICAgICAvLyA8aHR0cHM6Ly9naXRodWIuY29tL0F1dG9tYXR0aWMvanVpY2U+XG4gICAgICAgIGp1aWNlOiB0cnVlLFxuICAgICAgICBqdWljZVJlc291cmNlczoge1xuICAgICAgICAgIHByZXNlcnZlSW1wb3J0YW50OiB0cnVlLFxuICAgICAgICAgIHdlYlJlc291cmNlczoge1xuICAgICAgICAgICAgcmVsYXRpdmVUbzogcGF0aC5yZXNvbHZlKCdidWlsZCcpLFxuICAgICAgICAgICAgaW1hZ2VzOiBmYWxzZVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLy8gcGFzcyBhIHRyYW5zcG9ydCBjb25maWd1cmF0aW9uIG9iamVjdCBvciBhIHRyYW5zcG9ydCBpbnN0YW5jZVxuICAgICAgICAvLyAoZS5nLiBhbiBpbnN0YW5jZSBpcyBjcmVhdGVkIHZpYSBgbm9kZW1haWxlci5jcmVhdGVUcmFuc3BvcnRgKVxuICAgICAgICAvLyA8aHR0cHM6Ly9ub2RlbWFpbGVyLmNvbS90cmFuc3BvcnRzLz5cbiAgICAgICAgdHJhbnNwb3J0OiB7fVxuICAgICAgfSxcbiAgICAgIGNvbmZpZ1xuICAgICk7XG5cbiAgICAvLyBvdmVycmlkZSBleGlzdGluZyBtZXRob2RcbiAgICB0aGlzLnJlbmRlciA9IHRoaXMuY29uZmlnLnJlbmRlcjtcblxuICAgIGlmICghXy5pc0Z1bmN0aW9uKHRoaXMuY29uZmlnLnRyYW5zcG9ydC5zZW5kTWFpbCkpXG4gICAgICB0aGlzLmNvbmZpZy50cmFuc3BvcnQgPSBub2RlbWFpbGVyLmNyZWF0ZVRyYW5zcG9ydCh0aGlzLmNvbmZpZy50cmFuc3BvcnQpO1xuXG4gICAgZGVidWcoJ3RyYW5zZm9ybWVkIGNvbmZpZyAlTycsIHRoaXMuY29uZmlnKTtcblxuICAgIGF1dG9CaW5kKHRoaXMpO1xuICB9XG5cbiAgLy8gc2hvcnRoYW5kIHVzZSBvZiBganVpY2VSZXNvdXJjZXNgIHdpdGggdGhlIGNvbmZpZ1xuICAvLyAobWFpbmx5IGZvciBjdXN0b20gcmVuZGVycyBsaWtlIGZyb20gYSBkYXRhYmFzZSlcbiAganVpY2VSZXNvdXJjZXMoaHRtbCkge1xuICAgIHJldHVybiBqdWljZVJlc291cmNlcyhodG1sLCB0aGlzLmNvbmZpZy5qdWljZVJlc291cmNlcyk7XG4gIH1cblxuICAvLyBhIHNpbXBsZSBoZWxwZXIgZnVuY3Rpb24gdGhhdCBnZXRzIHRoZSBhY3R1YWwgZmlsZSBwYXRoIGZvciB0aGUgdGVtcGxhdGVcbiAgYXN5bmMgZ2V0VGVtcGxhdGVQYXRoKHZpZXcpIHtcbiAgICBjb25zdCBwYXRocyA9IGF3YWl0IGdldFBhdGhzKFxuICAgICAgdGhpcy5jb25maWcudmlld3Mucm9vdCxcbiAgICAgIHZpZXcsXG4gICAgICB0aGlzLmNvbmZpZy52aWV3cy5vcHRpb25zLmV4dGVuc2lvblxuICAgICk7XG4gICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLnJlc29sdmUodGhpcy5jb25maWcudmlld3Mucm9vdCwgcGF0aHMucmVsKTtcbiAgICByZXR1cm4geyBmaWxlUGF0aCwgcGF0aHMgfTtcbiAgfVxuXG4gIC8vIHJldHVybnMgdHJ1ZSBvciBmYWxzZSBpZiBhIHRlbXBsYXRlIGV4aXN0c1xuICAvLyAodXNlcyBzYW1lIGxvb2stdXAgYXBwcm9hY2ggYXMgYHJlbmRlcmAgZnVuY3Rpb24pXG4gIGFzeW5jIHRlbXBsYXRlRXhpc3RzKHZpZXcpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBmaWxlUGF0aCB9ID0gYXdhaXQgdGhpcy5nZXRUZW1wbGF0ZVBhdGgodmlldyk7XG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IHN0YXQoZmlsZVBhdGgpO1xuICAgICAgaWYgKCFzdGF0cy5pc0ZpbGUoKSkgdGhyb3cgbmV3IEVycm9yKGAke2ZpbGVQYXRofSB3YXMgbm90IGEgZmlsZWApO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBkZWJ1ZygndGVtcGxhdGVFeGlzdHMnLCBlcnIpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIHByb21pc2UgdmVyc2lvbiBvZiBjb25zb2xpZGF0ZSdzIHJlbmRlclxuICAvLyBpbnNwaXJlZCBieSBrb2Etdmlld3MgYW5kIHJlLXVzZXMgdGhlIHNhbWUgY29uZmlnXG4gIC8vIDxodHRwczovL2dpdGh1Yi5jb20vcXVlY2tlenova29hLXZpZXdzPlxuICBhc3luYyByZW5kZXIodmlldywgbG9jYWxzID0ge30pIHtcbiAgICBjb25zdCB7IG1hcCwgZW5naW5lU291cmNlIH0gPSB0aGlzLmNvbmZpZy52aWV3cy5vcHRpb25zO1xuICAgIGNvbnN0IHsgZmlsZVBhdGgsIHBhdGhzIH0gPSBhd2FpdCB0aGlzLmdldFRlbXBsYXRlUGF0aCh2aWV3KTtcbiAgICBpZiAocGF0aHMuZXh0ID09PSAnaHRtbCcgJiYgIW1hcCkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgcmVhZEZpbGUoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICByZXR1cm4gcmVzO1xuICAgIH1cbiAgICBjb25zdCBlbmdpbmVOYW1lID0gbWFwICYmIG1hcFtwYXRocy5leHRdID8gbWFwW3BhdGhzLmV4dF0gOiBwYXRocy5leHQ7XG4gICAgY29uc3QgcmVuZGVyRm4gPSBlbmdpbmVTb3VyY2VbZW5naW5lTmFtZV07XG4gICAgaWYgKCFlbmdpbmVOYW1lIHx8ICFyZW5kZXJGbilcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYEVuZ2luZSBub3QgZm91bmQgZm9yIHRoZSBcIi4ke3BhdGhzLmV4dH1cIiBmaWxlIGV4dGVuc2lvbmBcbiAgICAgICk7XG5cbiAgICBpZiAoXy5pc09iamVjdCh0aGlzLmNvbmZpZy5pMThuKSkge1xuICAgICAgY29uc3QgaTE4biA9IG5ldyBJMThOKFxuICAgICAgICBPYmplY3QuYXNzaWduKHt9LCB0aGlzLmNvbmZpZy5pMThuLCB7XG4gICAgICAgICAgcmVnaXN0ZXI6IGxvY2Fsc1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgICAgLy8gc3VwcG9ydCBgbG9jYWxzLnVzZXIubGFzdF9sb2NhbGVgXG4gICAgICAvLyAoZS5nLiBmb3IgPGh0dHBzOi8vbGFkLmpzLm9yZz4pXG4gICAgICBpZiAoXy5pc09iamVjdChsb2NhbHMudXNlcikgJiYgXy5pc1N0cmluZyhsb2NhbHMudXNlci5sYXN0X2xvY2FsZSkpXG4gICAgICAgIGxvY2Fscy5sb2NhbGUgPSBsb2NhbHMudXNlci5sYXN0X2xvY2FsZTtcblxuICAgICAgaWYgKF8uaXNTdHJpbmcobG9jYWxzLmxvY2FsZSkpIGkxOG4uc2V0TG9jYWxlKGxvY2Fscy5sb2NhbGUpO1xuICAgIH1cblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IFByb21pc2UucHJvbWlzaWZ5KHJlbmRlckZuKShmaWxlUGF0aCwgbG9jYWxzKTtcbiAgICAvLyB0cmFuc2Zvcm0gdGhlIGh0bWwgd2l0aCBqdWljZSB1c2luZyByZW1vdGUgcGF0aHNcbiAgICAvLyBnb29nbGUgbm93IHN1cHBvcnRzIG1lZGlhIHF1ZXJpZXNcbiAgICAvLyBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9nbWFpbC9kZXNpZ24vcmVmZXJlbmNlL3N1cHBvcnRlZF9jc3NcbiAgICBpZiAoIXRoaXMuY29uZmlnLmp1aWNlKSByZXR1cm4gcmVzO1xuICAgIGNvbnN0IGh0bWwgPSBhd2FpdCB0aGlzLmp1aWNlUmVzb3VyY2VzKHJlcyk7XG4gICAgcmV0dXJuIGh0bWw7XG4gIH1cblxuICBhc3luYyByZW5kZXJBbGwodGVtcGxhdGUsIGxvY2FscyA9IHt9LCBtZXNzYWdlID0ge30pIHtcbiAgICBsZXQgc3ViamVjdFRlbXBsYXRlRXhpc3RzID0gdGhpcy5jb25maWcuY3VzdG9tUmVuZGVyO1xuICAgIGxldCBodG1sVGVtcGxhdGVFeGlzdHMgPSB0aGlzLmNvbmZpZy5jdXN0b21SZW5kZXI7XG4gICAgbGV0IHRleHRUZW1wbGF0ZUV4aXN0cyA9IHRoaXMuY29uZmlnLmN1c3RvbVJlbmRlcjtcblxuICAgIGNvbnN0IHByb21pc2VzID0gW1xuICAgICAgdGhpcy50ZW1wbGF0ZUV4aXN0cyhgJHt0ZW1wbGF0ZX0vc3ViamVjdGApLFxuICAgICAgdGhpcy50ZW1wbGF0ZUV4aXN0cyhgJHt0ZW1wbGF0ZX0vaHRtbGApLFxuICAgICAgdGhpcy50ZW1wbGF0ZUV4aXN0cyhgJHt0ZW1wbGF0ZX0vdGV4dGApXG4gICAgXTtcblxuICAgIGlmICh0ZW1wbGF0ZSAmJiAhdGhpcy5jb25maWcuY3VzdG9tUmVuZGVyKVxuICAgICAgW1xuICAgICAgICBzdWJqZWN0VGVtcGxhdGVFeGlzdHMsXG4gICAgICAgIGh0bWxUZW1wbGF0ZUV4aXN0cyxcbiAgICAgICAgdGV4dFRlbXBsYXRlRXhpc3RzXG4gICAgICBdID0gYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuXG4gICAgaWYgKCFtZXNzYWdlLnN1YmplY3QgJiYgc3ViamVjdFRlbXBsYXRlRXhpc3RzKSB7XG4gICAgICBtZXNzYWdlLnN1YmplY3QgPSBhd2FpdCB0aGlzLnJlbmRlcihcbiAgICAgICAgYCR7dGVtcGxhdGV9L3N1YmplY3RgLFxuICAgICAgICBPYmplY3QuYXNzaWduKHt9LCBsb2NhbHMsIHsgcHJldHR5OiBmYWxzZSB9KVxuICAgICAgKTtcbiAgICAgIG1lc3NhZ2Uuc3ViamVjdCA9IG1lc3NhZ2Uuc3ViamVjdC50cmltKCk7XG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2Uuc3ViamVjdCAmJiB0aGlzLmNvbmZpZy5zdWJqZWN0UHJlZml4KVxuICAgICAgbWVzc2FnZS5zdWJqZWN0ID0gdGhpcy5jb25maWcuc3ViamVjdFByZWZpeCArIG1lc3NhZ2Uuc3ViamVjdDtcblxuICAgIGlmICghbWVzc2FnZS5odG1sICYmIGh0bWxUZW1wbGF0ZUV4aXN0cylcbiAgICAgIG1lc3NhZ2UuaHRtbCA9IGF3YWl0IHRoaXMucmVuZGVyKGAke3RlbXBsYXRlfS9odG1sYCwgbG9jYWxzKTtcblxuICAgIGlmICghbWVzc2FnZS50ZXh0ICYmIHRleHRUZW1wbGF0ZUV4aXN0cylcbiAgICAgIG1lc3NhZ2UudGV4dCA9IGF3YWl0IHRoaXMucmVuZGVyKFxuICAgICAgICBgJHt0ZW1wbGF0ZX0vdGV4dGAsXG4gICAgICAgIE9iamVjdC5hc3NpZ24oe30sIGxvY2FscywgeyBwcmV0dHk6IGZhbHNlIH0pXG4gICAgICApO1xuXG4gICAgaWYgKHRoaXMuY29uZmlnLmh0bWxUb1RleHQgJiYgbWVzc2FnZS5odG1sICYmICFtZXNzYWdlLnRleHQpXG4gICAgICAvLyB3ZSdkIHVzZSBub2RlbWFpbGVyLWh0bWwtdG8tdGV4dCBwbHVnaW5cbiAgICAgIC8vIGJ1dCB3ZSByZWFsbHkgZG9uJ3QgbmVlZCB0byBzdXBwb3J0IGNpZFxuICAgICAgLy8gPGh0dHBzOi8vZ2l0aHViLmNvbS9hbmRyaXM5L25vZGVtYWlsZXItaHRtbC10by10ZXh0PlxuICAgICAgbWVzc2FnZS50ZXh0ID0gaHRtbFRvVGV4dC5mcm9tU3RyaW5nKFxuICAgICAgICBtZXNzYWdlLmh0bWwsXG4gICAgICAgIHRoaXMuY29uZmlnLmh0bWxUb1RleHRcbiAgICAgICk7XG5cbiAgICAvLyBpZiB3ZSBvbmx5IHdhbnQgYSB0ZXh0LWJhc2VkIHZlcnNpb24gb2YgdGhlIGVtYWlsXG4gICAgaWYgKHRoaXMuY29uZmlnLnRleHRPbmx5KSBkZWxldGUgbWVzc2FnZS5odG1sO1xuXG4gICAgcmV0dXJuIG1lc3NhZ2U7XG4gIH1cblxuICBhc3luYyBzZW5kKG9wdGlvbnMgPSB7fSkge1xuICAgIG9wdGlvbnMgPSBPYmplY3QuYXNzaWduKFxuICAgICAge1xuICAgICAgICB0ZW1wbGF0ZTogJycsXG4gICAgICAgIG1lc3NhZ2U6IHt9LFxuICAgICAgICBsb2NhbHM6IHt9XG4gICAgICB9LFxuICAgICAgb3B0aW9uc1xuICAgICk7XG5cbiAgICBsZXQgeyB0ZW1wbGF0ZSwgbWVzc2FnZSwgbG9jYWxzIH0gPSBvcHRpb25zO1xuXG4gICAgY29uc3QgYXR0YWNobWVudHMgPVxuICAgICAgbWVzc2FnZS5hdHRhY2htZW50cyB8fCB0aGlzLmNvbmZpZy5tZXNzYWdlLmF0dGFjaG1lbnRzIHx8IFtdO1xuXG4gICAgbWVzc2FnZSA9IF8uZGVmYXVsdHNEZWVwKFxuICAgICAge30sXG4gICAgICBfLm9taXQobWVzc2FnZSwgJ2F0dGFjaG1lbnRzJyksXG4gICAgICBfLm9taXQodGhpcy5jb25maWcubWVzc2FnZSwgJ2F0dGFjaG1lbnRzJylcbiAgICApO1xuICAgIGxvY2FscyA9IF8uZGVmYXVsdHNEZWVwKHt9LCB0aGlzLmNvbmZpZy52aWV3cy5sb2NhbHMsIGxvY2Fscyk7XG5cbiAgICBpZiAoYXR0YWNobWVudHMpIG1lc3NhZ2UuYXR0YWNobWVudHMgPSBhdHRhY2htZW50cztcblxuICAgIGRlYnVnKCd0ZW1wbGF0ZSAlcycsIHRlbXBsYXRlKTtcbiAgICBkZWJ1ZygnbWVzc2FnZSAlTycsIG1lc3NhZ2UpO1xuICAgIGRlYnVnKCdsb2NhbHMgKGtleXMgb25seSk6ICVPJywgT2JqZWN0LmtleXMobG9jYWxzKSk7XG5cbiAgICAvLyBnZXQgYWxsIGF2YWlsYWJsZSB0ZW1wbGF0ZXNcbiAgICBjb25zdCBvYmogPSBhd2FpdCB0aGlzLnJlbmRlckFsbCh0ZW1wbGF0ZSwgbG9jYWxzLCBtZXNzYWdlKTtcblxuICAgIC8vIGFzc2lnbiB0aGUgb2JqZWN0IHZhcmlhYmxlcyBvdmVyIHRvIHRoZSBtZXNzYWdlXG4gICAgT2JqZWN0LmFzc2lnbihtZXNzYWdlLCBvYmopO1xuXG4gICAgaWYgKHRoaXMuY29uZmlnLnByZXZpZXcpIHtcbiAgICAgIGRlYnVnKCd1c2luZyBgcHJldmlldy1lbWFpbGAgdG8gcHJldmlldyBlbWFpbCcpO1xuICAgICAgYXdhaXQgcHJldmlld0VtYWlsKG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5jb25maWcuc2VuZCkge1xuICAgICAgZGVidWcoJ3NlbmQgZGlzYWJsZWQgc28gd2UgYXJlIGVuc3VyaW5nIEpTT05UcmFuc3BvcnQnKTtcbiAgICAgIC8vIDxodHRwczovL2dpdGh1Yi5jb20vbm9kZW1haWxlci9ub2RlbWFpbGVyL2lzc3Vlcy83OTg+XG4gICAgICAvLyBpZiAodGhpcy5jb25maWcudHJhbnNwb3J0Lm5hbWUgIT09ICdKU09OVHJhbnNwb3J0JylcbiAgICAgIHRoaXMuY29uZmlnLnRyYW5zcG9ydCA9IG5vZGVtYWlsZXIuY3JlYXRlVHJhbnNwb3J0KHtcbiAgICAgICAganNvblRyYW5zcG9ydDogdHJ1ZVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5jb25maWcudHJhbnNwb3J0LnNlbmRNYWlsKG1lc3NhZ2UpO1xuICAgIGRlYnVnKCdtZXNzYWdlIHNlbnQnKTtcbiAgICByZXMub3JpZ2luYWxNZXNzYWdlID0gbWVzc2FnZTtcbiAgICByZXR1cm4gcmVzO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gRW1haWw7XG4iXX0=