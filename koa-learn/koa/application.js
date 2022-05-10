"use strict";

/**
 * Module dependencies.
 */

const debug = require("debug")("koa:application");
const onFinished = require("on-finished");
const response = require("./response");
const compose = require("koa-compose");
const context = require("./context");
const request = require("./request");
const statuses = require("statuses");
const Emitter = require("events");
const util = require("util");
const Stream = require("stream");
const http = require("http");
const only = require("only");
const { HttpError } = require("http-errors");

/**
 * Expose `Application` class.
 * Inherits from `Emitter.prototype`.
 */

module.exports = class Application extends Emitter {
  /**
   * Initialize a new `Application`.
   *
   * @api public
   */

  /**
   *
   * @param {object} [options] Application options
   * @param {string} [options.env='development'] Environment
   * @param {string[]} [options.keys] Signed cookie keys
   * @param {boolean} [options.proxy] Trust proxy headers
   * @param {number} [options.subdomainOffset] Subdomain offset
   * @param {string} [options.proxyIpHeader] Proxy IP header, defaults to X-Forwarded-For
   * @param {number} [options.maxIpsCount] Max IPs read from proxy IP header, default to 0 (means infinity)
   *
   */

  constructor(options) {
    super();
    options = options || {}; // 配置项
    this.proxy = options.proxy || false; // 是否proxy模式
    this.subdomainOffset = options.subdomainOffset || 2; // domain需要忽略的偏移量
    this.proxyIpHeader = options.proxyIpHeader || "X-Forwarded-For"; // proxy的自定义header
    this.maxIpsCount = options.maxIpsCount || 0; // 代理服务器数量
    this.env = options.env || process.env.NODE_ENV || "development"; // 环境变量
    if (options.keys) this.keys = options.keys; // 自定义cookie的密钥
    this.middleware = []; // 中间件数组
    // 通过使用Object.create拷贝context、request、response
    // 目的：一个应用中可能会有多个new Koa对应的app，通过Object.create来防止这些app相互污染
    this.context = Object.create(context);
    this.request = Object.create(request);
    this.response = Object.create(response);
    if (util.inspect.custom) {
      // get app的时候去执行this.inspect
      // http://nodejs.cn/api/util.html#util_util_inspect_custom
      this[util.inspect.custom] = this.inspect;
    }
  }

  /**
   * Shorthand for:
   *
   *    http.createServer(app.callback()).listen(...)
   *
   * @param {Mixed} ...
   * @return {Server}
   * @api public
   */

  listen(...args) {
    debug("listen");
    const server = http.createServer(this.callback());
    return server.listen(...args);
  }

  /**
   * Return JSON representation.
   * We only bother showing settings.
   *
   * @return {Object}
   * @api public
   */

  toJSON() {
    return only(this, ["subdomainOffset", "proxy", "env"]);
  }

  /**
   * Inspect implementation.
   *
   * @return {Object}
   * @api public
   */

  inspect() {
    return this.toJSON();
  }

  /**
   * Use the given middleware `fn`.
   *
   * Old-style middleware will be converted.
   *
   * @param {Function} fn
   * @return {Application} self
   * @api public
   */

  use(fn) {
    /**
     * use函数的运行步骤
     * 1. 判断传入fn是否是一个函数
     * 2. 之后将fn push进入中间件数组
     */
    if (typeof fn !== "function")
      throw new TypeError("middleware must be a function!");
    debug("use %s", fn._name || fn.name || "-");
    this.middleware.push(fn);
    return this;
  }

  /**
   * Return a request handler callback
   * for node's native http server.
   *
   * @return {Function}
   * @api public
   */

  callback() {
    // TIP: compose 是koa中间件洋葱模型的核心
    const fn = compose(this.middleware);

    // koa错误处理，判断app上监听的错误数量
    if (!this.listenerCount("error")) this.on("error", this.onerror);

    const handleRequest = (req, res) => {
      // koa的委托模式会在这个函数里体现
      // 通过createContext创建ctx对象，将传入的req以及res包装成ctx返回
      const ctx = this.createContext(req, res);
      // 这个handleRequest不是callback内部的handleRequest，指的是app上的handleReq，因为有this
      // 之后调用app下的handleRequest
      return this.handleRequest(ctx, fn);
    };

    return handleRequest;
  }

  /**
   * Handle request in callback.
   *
   * @api private
   */

  handleRequest(ctx, fnMiddleware) {
    const res = ctx.res;
    res.statusCode = 404;
    const onerror = (err) => ctx.onerror(err);
    const handleResponse = () => respond(ctx);
    onFinished(res, onerror);
    return fnMiddleware(ctx).then(handleResponse).catch(onerror);
  }

  /**
   * Initialize a new context.
   *
   * @api private
   */

  createContext(req, res) {
    // 通过createContext包装出全局唯一的context
    /**
     * 以下三行可以在constructor中看出，context、request、response已经有了一次Object.create操作
     * 在createContext中继续操作一次的目的是
     * 让每一次的http请求都生成一个context，同时每次生成的context是全局唯一的，相互隔离
     */
    const context = Object.create(this.context);
    const request = (context.request = Object.create(this.request));
    const response = (context.response = Object.create(this.response));
    context.app = request.app = response.app = this;
    context.req = request.req = response.req = req;
    context.res = request.res = response.res = res;
    request.ctx = response.ctx = context;
    request.response = response;
    response.request = request;
    context.originalUrl = request.originalUrl = req.url;
    context.state = {};
    return context;
  }

  /**
   * Default error handler.
   *
   * @param {Error} err
   * @api private
   */

  onerror(err) {
    // When dealing with cross-globals a normal `instanceof` check doesn't work properly.
    // See https://github.com/koajs/koa/issues/1466
    // We can probably remove it once jest fixes https://github.com/facebook/jest/issues/2549.
    const isNativeError =
      Object.prototype.toString.call(err) === "[object Error]" ||
      err instanceof Error;
    if (!isNativeError)
      throw new TypeError(util.format("non-error thrown: %j", err));

    if (err.status === 404 || err.expose) return;
    if (this.silent) return;

    const msg = err.stack || err.toString();
    console.error(`\n${msg.replace(/^/gm, "  ")}\n`);
  }

  /**
   * Help TS users comply to CommonJS, ESM, bundler mismatch.
   * @see https://github.com/koajs/koa/issues/1513
   */

  static get default() {
    return Application;
  }
};

/**
 * Response helper.
 */

function respond(ctx) {
  // allow bypassing koa
  if (ctx.respond === false) return;

  if (!ctx.writable) return;

  const res = ctx.res;
  let body = ctx.body;
  const code = ctx.status;

  // ignore body
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null;
    return res.end();
  }

  if (ctx.method === "HEAD") {
    if (!res.headersSent && !ctx.response.has("Content-Length")) {
      const { length } = ctx.response;
      if (Number.isInteger(length)) ctx.length = length;
    }
    return res.end();
  }

  // status body
  if (body == null) {
    if (ctx.response._explicitNullBody) {
      ctx.response.remove("Content-Type");
      ctx.response.remove("Transfer-Encoding");
      ctx.length = 0;
      return res.end();
    }
    if (ctx.req.httpVersionMajor >= 2) {
      body = String(code);
    } else {
      body = ctx.message || String(code);
    }
    if (!res.headersSent) {
      ctx.type = "text";
      ctx.length = Buffer.byteLength(body);
    }
    return res.end(body);
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body);
  if (typeof body === "string") return res.end(body);
  if (body instanceof Stream) return body.pipe(res);

  // body: json
  body = JSON.stringify(body);
  if (!res.headersSent) {
    ctx.length = Buffer.byteLength(body);
  }
  res.end(body);
}

/**
 * Make HttpError available to consumers of the library so that consumers don't
 * have a direct dependency upon `http-errors`
 */

module.exports.HttpError = HttpError;
