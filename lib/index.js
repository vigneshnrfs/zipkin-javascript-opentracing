"use strict";

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
        if (!_n && _i["return"]) _i["return"]();
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
        "Invalid attempt to destructure non-iterable instance"
      );
    }
  };
})();

var _createClass = (function() {
  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }
  return function(Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps);
    return Constructor;
  };
})();

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

var _require = require("zipkin"),
  Annotation = _require.Annotation,
  BatchRecorder = _require.BatchRecorder,
  ExplicitContext = _require.ExplicitContext,
  Request = _require.Request,
  TraceId = _require.TraceId,
  _require$option = _require.option,
  Some = _require$option.Some,
  None = _require$option.None,
  Tracer = _require.Tracer,
  InetAddress = _require.InetAddress,
  sampler = _require.sampler,
  jsonEncoder = _require.jsonEncoder;

var _require2 = require("zipkin-transport-http"),
  HttpLogger = _require2.HttpLogger;

var availableTags = require("opentracing").Tags;
var JSON_V2 = jsonEncoder.JSON_V2;

var HttpHeaders = {
  TraceId: "x-b3-traceid",
  ParentSpanId: "x-b3-parentspanid",
  SpanId: "x-b3-spanid",
  Sampled: "x-b3-sampled"
};

var startSpanAnnotation = {
  client: Annotation.ClientSend,
  local: Annotation.ClientSend, // waiting for local PR in zipkin to get merged
  server: Annotation.ServerRecv
};

var addressAnnotation = {
  client: Annotation.ClientAddr,
  local: Annotation.ClientAddr, // waiting for local PR in zipkin to get merged
  server: Annotation.ServerAddr
};

var finishSpanAnnotation = {
  client: Annotation.ClientRecv,
  local: Annotation.ClientRecv, // waiting for local PR in zipkin to get merged
  server: Annotation.ServerSend
};

// copied from https://github.com/openzipkin/zipkin-js/blob/08f86b63a5fd7ded60762f537be1845ede588ffa/packages/zipkin/src/tracer/randomTraceId.js
function randomTraceId() {
  // === Generate a random 64-bit number in fixed-length hex format
  var digits = "0123456789abcdef";
  var n = "";
  for (var i = 0; i < 16; i++) {
    var rand = Math.floor(Math.random() * 16);
    n += digits[rand];
  }
  return n;
}

function makeOptional(val) {
  if (
    val &&
    typeof val.toString === "function" &&
    (val.toString().indexOf("Some") !== -1 ||
      val.toString().indexOf("None") !== -1)
  ) {
    return val;
  }

  if (val != null) {
    return new Some(val);
  } else {
    return None;
  }
}

function SpanCreator(_ref) {
  var tracer = _ref.tracer,
    serviceName = _ref.serviceName,
    kind = _ref.kind;

  return (function() {
    _createClass(Span, [
      {
        key: "_constructedFromOutside",
        value: function _constructedFromOutside(options) {
          return (
            typeof options.traceId === "object" &&
            typeof options.traceId.spanId === "string"
          );
        }
      },
      {
        key: "_getTraceId",
        value: function _getTraceId(options) {
          // construct from give traceId
          if (this._constructedFromOutside(options)) {
            var _options$traceId = options.traceId,
              traceId = _options$traceId.traceId,
              parentId = _options$traceId.parentId,
              spanId = _options$traceId.spanId,
              sampled = _options$traceId.sampled;

            return new TraceId({
              traceId: makeOptional(traceId),
              parentId: makeOptional(parentId),
              spanId: spanId,
              sampled: makeOptional(sampled)
            });
          }

          // construct with parent
          if (options.childOf !== null && typeof options.childOf === "object") {
            var parent = options.childOf;

            return new TraceId({
              traceId: makeOptional(parent.id.traceId),
              parentId: makeOptional(parent.id.spanId),
              spanId: randomTraceId(),
              sampled: parent.id.sampled
            });
          }

          // construct from give traceId
          return tracer.createRootId();
        }
      }
    ]);

    function Span(spanName, options) {
      _classCallCheck(this, Span);

      var id = this._getTraceId(options);
      this.id = id;

      if (!this._constructedFromOutside(options)) {
        tracer.scoped(function() {
          tracer.setId(id);
          if (spanName) {
            tracer.recordAnnotation(new Annotation.Rpc(spanName));
          }

          tracer.recordServiceName(serviceName);
          tracer.recordAnnotation(new startSpanAnnotation[kind]());
        });
      }
    }

    _createClass(Span, [
      {
        key: "log",
        value: function log() {
          var _this = this;

          var obj =
            arguments.length > 0 && arguments[0] !== undefined
              ? arguments[0]
              : {};

          tracer.scoped(function() {
            // make sure correct id is set
            tracer.setId(_this.id);

            Object.entries(obj).map(function(_ref2) {
              var _ref3 = _slicedToArray(_ref2, 2),
                key = _ref3[0],
                value = _ref3[1];

              tracer.recordBinary(
                key,
                typeof value !== "string" ? JSON.stringify(value) : value
              );
            });
          });
        }
      },
      {
        key: "setTag",
        value: function setTag(key, value) {
          var _this2 = this;

          tracer.scoped(function() {
            // make sure correct id is set
            tracer.setId(_this2.id);

            // some tags are treated specially by Zipkin
            switch (key) {
              case availableTags.PEER_ADDRESS:
                if (typeof value !== "string") {
                  throw new Error(
                    "Tag " + availableTags.PEER_ADDRESS + " needs a string"
                  );
                }

                var host = new InetAddress(value.split(":")[0]);
                var port = value.split(":")[1]
                  ? parseInt(value.split(":")[1], 10)
                  : 80;

                var address = {
                  serviceName: serviceName,
                  host: host,
                  port: port
                };

                tracer.recordAnnotation(new addressAnnotation[kind](address));
                break;

              // Otherwise, set arbitrary key/value tags using Zipkin binary annotations
              default:
                tracer.recordAnnotation(
                  new Annotation.BinaryAnnotation(key, value)
                );
            }
          });
        }
      },
      {
        key: "finish",
        value: function finish() {
          var _this3 = this;

          tracer.scoped(function() {
            // make sure correct id is set
            tracer.setId(_this3.id);
            tracer.recordAnnotation(new finishSpanAnnotation[kind]());
          });
        }
      }
    ]);

    return Span;
  })();
}

var Tracing = (function() {
  function Tracing() {
    var options =
      arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    _classCallCheck(this, Tracing);

    // serviceName: the name of the service monitored with this tracer
    if (typeof options.serviceName !== "string") {
      throw new Error("serviceName option needs to be provided");
    }

    if (typeof options.recorder !== "object") {
      if (typeof options.endpoint !== "string") {
        throw new Error("recorder or endpoint option needs to be provided");
      }

      if (options.endpoint.indexOf("http") === -1) {
        throw new Error(
          "endpoint value needs to start with http:// or https://"
        );
      }

      options.recorder = new BatchRecorder({
        logger: new HttpLogger({
          endpoint: options.endpoint + "/api/v2/spans",
          jsonEncoder: JSON_V2
        })
      });
    }

    if (
      options.kind !== "client" &&
      options.kind !== "server" &&
      options.kind !== "local"
    ) {
      throw new Error(
        'kind option needs to be provided as either "local", "client" or "server"'
      );
    }

    options.sampler = options.sampler || sampler.alwaysSample;

    this._serviceName = options.serviceName;

    this._zipkinTracer = new Tracer({
      ctxImpl: new ExplicitContext(),
      recorder: options.recorder
    });
    this._Span = SpanCreator({
      tracer: this._zipkinTracer,
      serviceName: this._serviceName,
      kind: options.kind,
      sampler: options.sampler
    });
  }

  _createClass(Tracing, [
    {
      key: "startSpan",
      value: function startSpan(name) {
        var options =
          arguments.length > 1 && arguments[1] !== undefined
            ? arguments[1]
            : {};

        if (typeof name !== "string") {
          throw new Error(
            "startSpan needs an operation name as string as first argument.\n                For more details, please see https://github.com/opentracing/specification/blob/master/specification.md#start-a-new-span"
          );
        }

        return new this._Span(name, options);
      }
    },
    {
      key: "inject",
      value: function inject(span, format, carrier) {
        if (typeof span !== "object") {
          throw new Error("inject called without a span");
        }

        if (format !== Tracing.FORMAT_HTTP_HEADERS) {
          throw new Error("inject called with unsupported format");
        }

        if (typeof carrier !== "object") {
          throw new Error("inject called without a carrier object");
        }

        carrier[HttpHeaders.TraceId] = span.id.traceId;
        carrier[HttpHeaders.SpanId] = span.id.spanId;
        carrier[HttpHeaders.ParentSpanId] = span.id.parentId;
        carrier[HttpHeaders.Sampled] = span.id.sampled.getOrElse("0");
      }
    },
    {
      key: "extract",
      value: function extract(format, carrier) {
        if (format !== Tracing.FORMAT_HTTP_HEADERS) {
          throw new Error("extract called with unsupported format");
        }

        if (typeof carrier !== "object") {
          throw new Error("extract called without a carrier");
        }

        if (!carrier[HttpHeaders.TraceId]) {
          return null;
        }

        // XXX: no empty string here v
        // We should send the span name too
        // TODO: take a look for span name here: https://github.com/openzipkin/zipkin-go-opentracing/blob/594640b9ef7e5c994e8d9499359d693c032d738c/propagation_ot.go#L26
        var span = new this._Span("", {
          traceId: {
            traceId: carrier[HttpHeaders.TraceId],
            parentId: carrier[HttpHeaders.ParentSpanId],
            spanId: carrier[HttpHeaders.SpanId],
            sampled: carrier[HttpHeaders.Sampled]
          }
        });

        return span;
      }
    }
  ]);

  return Tracing;
})();

Tracing.FORMAT_TEXT_MAP = "text_map";
Tracing.FORMAT_HTTP_HEADERS = "http_headers";
Tracing.FORMAT_BINARY = "binary";

// For testing purposes
Tracing.makeOptional = makeOptional;

module.exports = Tracing;
