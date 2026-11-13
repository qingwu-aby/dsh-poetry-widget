// 窄 facade：只导出跨域需要的符号，避免 `export *` 把整域拉进来形成循环。
export { naturalStyleLines } from './language-style.mjs'
