/** A fixed bootstrap runs inside the opaque iframe; no Host callbacks enter its document. */
import { decodeText, encodeText } from './bytes.ts'
import { EXTERNAL_LINK_MESSAGE } from './external-link.ts'

/** One statically declared local script or stylesheet, already read under the source file's authority. */
export interface HtmlAsset {
  readonly kind: 'script' | 'stylesheet'
  /** Original HTML attribute, not a Host absolute path. */
  readonly reference: string
  readonly data: Uint8Array<ArrayBuffer>
}

/** Complete bytes for one document; dependencies are finite and never requested by iframe messages. */
export interface HtmlBundle {
  readonly data: Uint8Array<ArrayBuffer>
  readonly assets: readonly HtmlAsset[]
}

/**
 * Build the outer iframe document. Its resource URLs are created inside the sandbox,
 * because that opaque origin cannot load resource URLs created by the parent.
 * @param bundle - complete HTML bytes and optional static dependencies.
 * @returns bootstrap HTML; invalid UTF-8 throws before navigation.
 */
export function createHtmlDocument(bundle: HtmlBundle): string {
  const payload = encodeText(JSON.stringify({
    html: decodeText(bundle.data),
    assets: bundle.assets.map(asset => ({ kind: asset.kind, reference: asset.reference, text: decodeText(asset.data) })),
  }))
  return `<!doctype html><meta charset="utf-8"><script>(()=>{
const bytes=data=>Uint8Array.from(atob(data),character=>character.charCodeAt(0));
const text=data=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(data));
const bundle=JSON.parse(text("${payload}"));
const type=${JSON.stringify(EXTERNAL_LINK_MESSAGE)};
// The click bridge runs on the window, which outlives the document replacement
// below, and forwards a user's click on an HTTP(S) link to the application.
// The frame resolves the link against its own base; the application validates
// the posted URL again before it opens anything.
window.addEventListener('click',event=>{
if(!event.isTrusted)return;
const activation=globalThis.navigator?.userActivation;
if(activation!==undefined&&!activation.isActive)return;
const target=event.target;
if(target===null||typeof target.closest!=='function')return;
const anchor=target.closest('a[href]');
if(anchor===null)return;
const href=anchor.getAttribute('href');
if(href===null||href.startsWith('#'))return;
let url;
try{url=new URL(href,document.baseURI);}catch{return;}
if(url.protocol!=='http:'&&url.protocol!=='https:')return;
if(url.username!==''||url.password!=='')return;
event.preventDefault();
parent.postMessage({type,url:url.href},'*');
},true);
let html=bundle.html;
if(bundle.assets.length){
  const parsed=new DOMParser().parseFromString(html,'text/html');
  for(const asset of bundle.assets){
    const script=asset.kind==='script';
    const url=URL.createObjectURL(new Blob([asset.text],{type:script?'application/javascript':'text/css'}));
    const attribute=script?'src':'href';
    for(const element of parsed.querySelectorAll(script?'script[src]':'link[rel~="stylesheet" i][href]')){
      if(element.getAttribute(attribute)===asset.reference)element.setAttribute(attribute,url);
    }
  }
  html='<!doctype html>'+parsed.documentElement.outerHTML;
}
document.open();document.write(html);document.close();
})()</script>`
}
