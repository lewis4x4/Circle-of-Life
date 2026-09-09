import http from 'node:http';
const server=http.createServer((req,res)=>{
 const route=req.url.startsWith('/auth/v1/')?{prefix:'/auth/v1',port:59833}:req.url.startsWith('/rest/v1/')?{prefix:'/rest/v1',port:59832}:null;
 if(!route){res.writeHead(404);res.end();return;}
 const upstream=http.request({host:'127.0.0.1',port:route.port,path:req.url.slice(route.prefix.length),method:req.method,headers:{...req.headers,host:'127.0.0.1:'+route.port}},incoming=>{res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);});
 upstream.setTimeout(30000,()=>upstream.destroy());
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end('{"error":"Local upstream unavailable"}');});
 req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
server.listen(59831,'127.0.0.1');
