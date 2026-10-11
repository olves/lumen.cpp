'use strict';
// Minimal GGUF header reader. Reads only the key/value metadata at the start of a model file (no tensors), skips large arrays
// such as the tokenizer vocabulary without keeping them, and stops at a byte limit. Used for model names, architecture,
// context limits, attention/expert shapes and the chat template.
const fs=require('node:fs');
const MAX_HEADER=192*1024*1024,CHUNK=1024*1024;
const TYPES={0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8};

async function readGguf(file,{keep=()=>true,maxArray=64}={}){
 const handle=await fs.promises.open(file,'r');
 try{
  let buffer=Buffer.alloc(0),offset=0,position=0;
  async function need(n){
   if(buffer.length-offset>=n)return;
   if(position>MAX_HEADER)throw Error('GGUF header is too large.');
   const rest=buffer.subarray(offset),size=Math.max(CHUNK,n-rest.length),chunk=Buffer.alloc(size);
   const {bytesRead}=await handle.read(chunk,0,size,position);position+=bytesRead;
   buffer=Buffer.concat([rest,chunk.subarray(0,bytesRead)]);offset=0;
   if(buffer.length<n)throw Error('Unexpected end of GGUF header.');
  }
  const u32=async()=>{await need(4);const v=buffer.readUInt32LE(offset);offset+=4;return v;};
  const u64=async()=>{await need(8);const v=buffer.readBigUInt64LE(offset);offset+=8;if(v>BigInt(Number.MAX_SAFE_INTEGER))throw Error('GGUF value out of range.');return Number(v);};
  async function string(store=true){const length=await u64();if(length>64*1024*1024)throw Error('GGUF string too long.');if(!store){await skip(length);return null;}await need(length);const v=buffer.toString('utf8',offset,offset+length);offset+=length;return v;}
  async function skip(n){while(n>0){const available=buffer.length-offset;if(available>=n){offset+=n;return;}n-=available;offset=buffer.length;await need(Math.min(n,CHUNK));}}
  async function scalar(type){
   const size=TYPES[type];if(!size)throw Error('Unknown GGUF type '+type+'.');await need(size);let v;
   switch(type){case 0:v=buffer.readUInt8(offset);break;case 1:v=buffer.readInt8(offset);break;case 2:v=buffer.readUInt16LE(offset);break;case 3:v=buffer.readInt16LE(offset);break;case 4:v=buffer.readUInt32LE(offset);break;case 5:v=buffer.readInt32LE(offset);break;case 6:v=buffer.readFloatLE(offset);break;case 7:v=buffer.readUInt8(offset)!==0;break;case 10:v=Number(buffer.readBigUInt64LE(offset));break;case 11:v=Number(buffer.readBigInt64LE(offset));break;case 12:v=buffer.readDoubleLE(offset);break;}
   offset+=size;return v;
  }
  async function value(type,store){
   if(type===8)return string(store);
   if(type===9){const inner=await u32(),count=await u64();const small=store&&count<=maxArray;const items=small?[]:null;
    if(!small&&inner!==8&&inner!==9&&TYPES[inner]){await skip(count*TYPES[inner]);return {length:count};}
    for(let i=0;i<count;i++){const v=await value(inner,small);if(small)items.push(v);}return small?items:{length:count};}
   return scalar(type);
  }
  await need(8);if(buffer.toString('ascii',0,4)!=='GGUF')throw Error('Not a GGUF file.');offset=4;
  const version=await u32();if(version<2||version>3)throw Error('Unsupported GGUF version '+version+'.');
  const tensors=await u64(),count=await u64();if(count>100000)throw Error('Too many GGUF keys.');
  const meta={};
  for(let i=0;i<count;i++){const key=await string();const type=await u32();const store=keep(key);const v=await value(type,store);if(store)meta[key]=v;}
  return {version,tensors,meta};
 }finally{await handle.close();}
}
module.exports={readGguf};
