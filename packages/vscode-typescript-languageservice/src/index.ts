import type { LanguageServiceHost } from 'typescript'
import type { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'path'
import * as ts from 'typescript'
import * as fg from 'fast-glob'
import * as hover from './services/hover'
import { fsPathToUri, uriToFsPath, normalizeFileName } from '@dali/shared'
import type { TextDocuments } from 'vscode-languageserver/node';

export function createLanguageService(
  ts: typeof import('typescript/lib/tsserverlibrary'),
  documents: TextDocuments<TextDocument>,
  folders: string[]
) {

  let projectVersion = 0
  let parsedCommandLine: ts.ParsedCommandLine
  const tsConfigNames = ['tsconfig.json']
  const tsConfigSet = new Set(folders.map(folder => ts.sys.readDirectory(folder, tsConfigNames, undefined, ['**/*'])).flat())
  const tsConfigs = [...tsConfigSet].filter(tsConfig => tsConfigNames.includes(path.basename(tsConfig)))
  parsedCommandLine = createParsedCommandLine(ts, tsConfigs[0])
  const mds = fg.sync('components/**/*.md')
  const host = createTsLanguageServiceHost()
  const languageService = ts.createLanguageService(host, ts.createDocumentRegistry())

  return {
    dispose,
    doHover: hover.register(languageService, getTextDocument, ts)
  }

  function dispose() {
		languageService.dispose()
	}

  function createTsLanguageServiceHost() {
    const scriptSnapshots = new Map<string, [string, ts.IScriptSnapshot]>();
    const host: LanguageServiceHost = {
      // ts
			getNewLine: () => ts.sys.newLine,
			useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
			readFile: ts.sys.readFile,
			writeFile: ts.sys.writeFile,
			directoryExists: ts.sys.directoryExists,
			getDirectories: ts.sys.getDirectories,
			readDirectory: ts.sys.readDirectory,
			realpath: ts.sys.realpath,
      fileExists,
      getCompilationSettings: () => parsedCommandLine.options,
      getProjectVersion: () => `${projectVersion}`,
      getScriptFileNames: () => [
        ...parsedCommandLine.fileNames,
        ...mds.map(md => `${md}__TS.tsx`)
      ],
      getScriptVersion: () => '',
      getCurrentDirectory: () => path.dirname(tsConfigs[0]),
      getScriptSnapshot,
      getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    }
    return host
  }

  function fileExists(_fileName: string) {
    const fileName = normalizeFileName(ts.sys.realpath?.(_fileName) ?? _fileName)
    const fileExists = !!ts.sys.fileExists?.(fileName)

    return fileExists
  }

  function getScriptSnapshot(fileName: string) {
    const text = getScriptText(fileName)
    if (text !== undefined) {
      return ts.ScriptSnapshot.fromString(text)
    }
  }

  function getScriptText(fileName: string) {
    const doc = documents.get(fsPathToUri(fileName))
    if (doc) {
      return doc.getText()
    }
    if (ts.sys.fileExists(fileName)) {
      return ts.sys.readFile(fileName, 'utf8')
    }
    if (fileName.endsWith('__TS.tsx')) {
      return `
import { Calendar } from 'antd';

function onPanelChange(value, mode) {
  console.log(value.format('YYYY-MM-DD'), mode);
}

ReactDOM.render(<Calendar onPanelChange={onPanelChange} />, mountNode);
      `
    }
  }

  function getTextDocument(uri: string) {
    const fileName = uriToFsPath(uri);
		if (!languageService.getProgram()?.getSourceFile(fileName)) {
			return;
		}
		return documents.get(uri)
  }
}

function createParsedCommandLine(ts: typeof import('typescript/lib/tsserverlibrary'), tsConfig: string) {
	const parseConfigHost: ts.ParseConfigHost = {
		...ts.sys,
		readDirectory: ts.sys.readDirectory,
	};
	const realTsConfig = ts.sys.realpath!(tsConfig);
	const config = ts.readJsonConfigFile(realTsConfig, ts.sys.readFile);
	const content = ts.parseJsonSourceFileConfigFileContent(config, parseConfigHost, path.dirname(realTsConfig), {}, path.basename(realTsConfig));
	content.options.outDir = undefined;
	content.fileNames = content.fileNames.map(normalizeFileName);
	return content;
}
