const koaYz = require("./koa-yz/application");

const app = new koaYz();

app.use((ctx) => {
    console.log(ctx.req.url)
//   console.log(ctx.req.url);
//   console.log(ctx.request.req.url);
//   console.log(ctx.response.req.url);
//   console.log(ctx.request.url);
//   console.log(ctx.request.path);
//   console.log(ctx.url);
//   console.log(ctx.path);
});

app.listen(3000, () => {
  console.log("server listening on port 3000");
});
