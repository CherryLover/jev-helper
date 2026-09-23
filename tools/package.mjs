import fs from 'node:fs/promises';
import path from 'node:path';
import {crc32} from './binary.mjs';
async function walk(root,prefix=''){const out=[];for(const e of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){const name=path.posix.join(prefix,e.name);if(e.isDirectory())out.push(...await walk(root,name));else out.push(name);}return out.sort();}
const files=await walk('dist'),body=[],directory=[];let offset=0;
for(const file of files){
  const name=Buffer.from(file),data=await fs.readFile(path.join('dist',file)),crc=crc32(data);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  body.push(local,name,data);directory.push(central,name);offset+=local.length+name.length+data.length;
}
const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
await fs.mkdir('artifacts',{recursive:true});const {version}=JSON.parse(await fs.readFile('package.json','utf8'));const out=`artifacts/werhd-jev-extension-${version}.zip`;await fs.writeFile(out,Buffer.concat([...body,central,end]));console.log(out);
