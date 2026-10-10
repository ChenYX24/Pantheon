import path from 'node:path'
import ts from 'typescript'

// Keep the real import graph and strict application options, but ask for
// diagnostics only in the named files. Checking every unchanged component
// exhausts the shared session pool before it reaches the edited entrypoints.
const files = process.argv.slice(2).map((file) => path.resolve(file))
if (!files.length) throw new Error('Pass the source files to check.')
const config = ts.readConfigFile('tsconfig.app.json', ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, process.cwd())
const program = ts.createProgram(files, { ...parsed.options, incremental: false, noEmit: true })
const diagnostics = [
  ...(config.error ? [config.error] : []), ...parsed.errors,
  ...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(),
]
for (const file of files) {
  const source = program.getSourceFile(file)
  if (!source) throw new Error(`Source not found: ${file}`)
  diagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source))
}
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: (file) => file,
    getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log(`Type-checked ${files.length} file(s) with their import graph.`)
