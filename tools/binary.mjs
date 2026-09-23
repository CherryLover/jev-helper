import {deflateSync} from 'node:zlib';
export function crc32(data){let c=0xffffffff;for(const x of data){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export function iconPng(size){
  const raw=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=x/size,sy=y/size;
    const gold=(sx>.58&&sx<.75&&sy>.21&&sy<.64)||(sx>.26&&sx<.75&&sy>.62&&sy<.78)||(sx>.23&&sx<.4&&sy>.49&&sy<.67)||(sx>.38&&sx<.75&&sy>.19&&sy<.34);
    const at=y*(size*4+1)+1+x*4;raw.set(gold?[217,183,111,255]:[20,32,42,255],at);
  }
  const chunk=(name,data)=>{const type=Buffer.from(name),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([len,type,data,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
