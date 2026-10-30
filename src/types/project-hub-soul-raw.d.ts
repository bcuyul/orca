/** Explicit raw Markdown declarations shared by Electron main and renderer TypeScript projects. */
declare module '*.md?raw' {
  const contents: string
  export default contents
}
