const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture(qr) {
 const module={exports:{}};let creations=0;
 const api={get:async url=>url==='/customers'?{data:{data:[{id:'cus_test'}]}}:url==='/payments'?{data:{data:[{id:'pay_existing',customer:'cus_test',billingType:'PIX',value:5}]}}:{status:200,data:qr},post:async()=>{creations++;throw Error('Unexpected creation');}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/asaasService.js'),'utf8'),{module,Buffer,URL,console:{error(){}},process:{env:{ASAAS_API_KEY:'test',ASAAS_URL:'https://api.asaas.com/v3'}},require:()=>({create:()=>api})});
 return {...module.exports,creations:()=>creations};
}
test('failed QR retrieval reuses existing charge on retry',async()=>{
 const f=fixture({success:false,errors:[{description:'Pix indisponivel'}]});
 for(let i=0;i<2;i++) await assert.rejects(f.createPix({nome:'Cliente',cpf:'12345678900',valor:5,reference:'same-request'}),/Pix indisponivel/);
 assert.equal(f.creations(),0);
});
test('HTML response produces configuration error instead of missing payload',async()=>{
 await assert.rejects(fixture('<html>').pix('pay_existing'),/ASAAS_URL/);
});
