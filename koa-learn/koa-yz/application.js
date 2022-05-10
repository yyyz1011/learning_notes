const Emitter = require("events");
const http = require("http");

const context = require("./context");
const response = require("./response");
const request = require("./request");

class Application extends Emitter {
  constructor() {
    super();
    this.fn;
    this.context = Object.create(context);
    this.response = Object.create(response);
    this.request = Object.create(request);
  }
  use(fn) {
    this.fn = fn;
  }
  createContext(req, res) {
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
  handleRequest(req, res) {
    let ctx = this.createContext(req, res);
    this.fn(ctx);
    res.end(ctx.body);
  }
  listen(...args) {
    const server = http.createServer(this.handleRequest.bind(this));
    server.listen(...args);
  }
}

module.exports = Application;
