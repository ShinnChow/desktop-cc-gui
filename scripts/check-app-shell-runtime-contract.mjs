import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { ESLint } from "eslint";
import ts from "typescript";

const APP_SHELL_FILE = "src/app-shell.tsx";
/** 三刀后：bag / search input 装配在 assembly host */
const APP_SHELL_COMPOSITION_FILE =
  "src/app-shell/hosts/useAppShellAssemblyHost.ts";
/** T2.1–T2.3：section hooks 在 AppShellView（Providers 下） */
const APP_SHELL_VIEW_FILE = "src/app-shell/assembly/appShellView.tsx";
/** T1.1：domain bag 字面量在 assembly 模块 */
const APP_SHELL_DOMAIN_ASSEMBLY_FILE =
  "src/app-shell/domains/useAppShellDomainAssembly.ts";
const SEARCH_SECTION_FILE =
  "src/app-shell/sections/useAppShellSearchAndComposerSection.ts";
const SECTIONS_FILE = "src/app-shell/sections/core/useAppShellSections.ts";
const LAYOUT_FILE =
  "src/app-shell/sections/layoutNodes/useAppShellLayoutNodesSection.tsx";
const RENDER_FILE = "src/app-shell/render/renderAppShell.tsx";
const APP_SHELL_DOMAIN_CONTEXT_NAMES = new Set([
  "runtimeThreadContext",
  "sessionIdentityContext",
  "workspaceCatalogContext",
  "gitSurfaceContext",
  "modeRoutingContext",
  "accountSurfaceContext",
  "workspaceNavigationContext",
  "composerContext",
  "layoutContext",
  "fileEditorContext",
  "settingsContext",
  "threadDataContext",
  "runtimeContext",
  "modelSelectionContext",
  "collaborationModeContext",
]);
const LEGACY_CONTEXT_DESTRUCTURE_IDENTIFIERS = new Set([
  "ctx",
  "legacyCtx",
  // T2.4：search/composer 分组入参展平后的 boundary 解构
  "boundary",
]);

const CONTRACT_FILES = [
  APP_SHELL_FILE,
  APP_SHELL_COMPOSITION_FILE,
  APP_SHELL_VIEW_FILE,
  APP_SHELL_DOMAIN_ASSEMBLY_FILE,
  SEARCH_SECTION_FILE,
  SECTIONS_FILE,
  LAYOUT_FILE,
  RENDER_FILE,
];

const PARSER_OPTIONS_JSON = JSON.stringify({
  ecmaVersion: 2022,
  sourceType: "module",
  ecmaFeatures: { jsx: true },
});

function toAbsolutePath(relativePath) {
  return path.resolve(process.cwd(), relativePath);
}

function getProgramSourceFile(program, relativePath) {
  const absolutePath = toAbsolutePath(relativePath);
  const sourceFile = program.getSourceFile(absolutePath);
  if (!sourceFile) {
    throw new Error(`Cannot load source file "${relativePath}".`);
  }
  return sourceFile;
}

function visitNode(node, callback) {
  callback(node);
  node.forEachChild((child) => visitNode(child, callback));
}

function getPropertyNameText(name) {
  if (!name) {
    return null;
  }
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function collectObjectLiteralOwnKeys(objectLiteral) {
  const keys = new Set();
  for (const property of objectLiteral.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      keys.add(property.name.text);
      continue;
    }
    if (
      ts.isPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    ) {
      const key = getPropertyNameText(property.name);
      if (key) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function findFunctionDeclaration(sourceFile, functionName) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === functionName
    ) {
      if (!statement.body) {
        throw new Error(`Function "${functionName}" has no body.`);
      }
      return statement;
    }
  }
  throw new Error(`Cannot find function "${functionName}" in ${sourceFile.fileName}.`);
}

function getVariableObjectLiteral(sourceFile, variableName) {
  let result = null;
  visitNode(sourceFile, (node) => {
    if (result) {
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer
    ) {
      result = getInitializerObjectLiteral(node.initializer);
    }
  });

  if (!result) {
    throw new Error(`Cannot find object literal variable "${variableName}" in ${sourceFile.fileName}.`);
  }
  return result;
}

/** T1.1：production bag 在 assembleAppShellDomainContexts → defineAppShellDomainContexts({...}) */
function getDefineAppShellDomainContextsObjectLiteral(sourceFile) {
  let result = null;
  visitNode(sourceFile, (node) => {
    if (result) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineAppShellDomainContexts" &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      result = node.arguments[0];
    }
  });
  if (!result) {
    throw new Error(
      `Cannot find defineAppShellDomainContexts({...}) in ${sourceFile.fileName}.`,
    );
  }
  return result;
}

function collectDomainContextKeySetsFromObjectLiteral(sourceFile, objectLiteral, label) {
  const sourceKeysByIdentifier = collectLocalObjectLiteralSourceKeys(sourceFile);
  const domainKeys = new Map();
  const allKeys = new Set();

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const domainName = getPropertyNameText(property.name);
    if (!domainName || !APP_SHELL_DOMAIN_CONTEXT_NAMES.has(domainName)) {
      continue;
    }
    const domainObject = getInitializerObjectLiteral(property.initializer);
    if (!domainObject) {
      continue;
    }
    const keys = collectObjectLiteralEffectiveKeysDeep(
      domainObject,
      sourceKeysByIdentifier,
    );
    domainKeys.set(domainName, keys);
    for (const key of keys) {
      allKeys.add(key);
    }
  }

  if (domainKeys.size === 0) {
    throw new Error(
      `Cannot find domain context object literals in "${label}" (${sourceFile.fileName}).`,
    );
  }

  return { domainKeys, allKeys };
}

function collectDomainContextKeySets(sourceFile, variableName) {
  const objectLiteral = getVariableObjectLiteral(sourceFile, variableName);
  return collectDomainContextKeySetsFromObjectLiteral(
    sourceFile,
    objectLiteral,
    variableName,
  );
}

function collectDomainContextKeySetsFromDefineCall(sourceFile) {
  const objectLiteral = getDefineAppShellDomainContextsObjectLiteral(sourceFile);
  return collectDomainContextKeySetsFromObjectLiteral(
    sourceFile,
    objectLiteral,
    "defineAppShellDomainContexts",
  );
}

function getInitializerObjectLiteral(initializer) {
  if (!initializer) {
    return null;
  }
  if (ts.isObjectLiteralExpression(initializer)) {
    return initializer;
  }
  if (
    ts.isCallExpression(initializer) &&
    initializer.arguments.length > 0 &&
    ts.isObjectLiteralExpression(initializer.arguments[0])
  ) {
    return initializer.arguments[0];
  }
  return null;
}

function collectLocalObjectLiteralSourceKeys(rootNode) {
  const sourceKeys = new Map();
  visitNode(rootNode, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name)
    ) {
      return;
    }
    const objectLiteral = getInitializerObjectLiteral(node.initializer);
    if (!objectLiteral) {
      return;
    }
    sourceKeys.set(node.name.text, collectObjectLiteralOwnKeys(objectLiteral));
  });
  return sourceKeys;
}

function collectObjectLiteralEffectiveKeys(objectLiteral, sourceKeysByIdentifier) {
  const keys = collectObjectLiteralOwnKeys(objectLiteral);
  for (const property of objectLiteral.properties) {
    if (!ts.isSpreadAssignment(property) || !ts.isIdentifier(property.expression)) {
      continue;
    }
    const spreadKeys = sourceKeysByIdentifier.get(property.expression.text);
    if (!spreadKeys) {
      continue;
    }
    for (const key of spreadKeys) {
      keys.add(key);
    }
  }
  return keys;
}

/** T1.10：展开 builder 入参中的嵌套 object（如 sessionHot），避免 hot keys 丢失 */
function collectObjectLiteralEffectiveKeysDeep(
  objectLiteral,
  sourceKeysByIdentifier,
) {
  const keys = collectObjectLiteralEffectiveKeys(
    objectLiteral,
    sourceKeysByIdentifier,
  );
  for (const property of objectLiteral.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isObjectLiteralExpression(property.initializer)
    ) {
      continue;
    }
    const nested = collectObjectLiteralEffectiveKeysDeep(
      property.initializer,
      sourceKeysByIdentifier,
    );
    for (const key of nested) {
      keys.add(key);
    }
  }
  return keys;
}

function checkObjectLiteralShorthandBindingsInObject(
  sourceFile,
  objectLiteral,
  label,
  checker,
) {
  const issues = [];

  for (const property of objectLiteral.properties) {
    if (!ts.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const symbol = checker.getSymbolAtLocation(property.name);
    if (!symbol) {
      issues.push(
        `[${label}] shorthand "${property.name.text}" has no resolvable symbol.`,
      );
      continue;
    }
    const declarations = symbol.declarations ?? [];
    const hasLocalDeclaration = declarations.some(
      (declaration) => declaration.getSourceFile().fileName === sourceFile.fileName,
    );
    if (!hasLocalDeclaration) {
      issues.push(
        `[${label}] shorthand "${property.name.text}" resolves to a non-local symbol (likely global).`,
      );
    }
  }

  return issues;
}

function checkDomainContextShorthandBindingsInDomainBag(
  sourceFile,
  objectLiteral,
  label,
  checker,
) {
  const issues = [];

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const domainName = getPropertyNameText(property.name);
    if (!domainName || !APP_SHELL_DOMAIN_CONTEXT_NAMES.has(domainName)) {
      continue;
    }
    const domainObject = getInitializerObjectLiteral(property.initializer);
    if (!domainObject) {
      continue;
    }
    issues.push(
      ...checkObjectLiteralShorthandBindingsInObject(
        sourceFile,
        domainObject,
        `${label}.${domainName}`,
        checker,
      ),
    );
  }

  return issues;
}

function checkDomainContextShorthandBindings(sourceFile, variableName, checker) {
  const objectLiteral = getVariableObjectLiteral(sourceFile, variableName);
  return checkDomainContextShorthandBindingsInDomainBag(
    sourceFile,
    objectLiteral,
    variableName,
    checker,
  );
}

function checkDomainContextShorthandBindingsFromDefineCall(sourceFile, checker) {
  const objectLiteral = getDefineAppShellDomainContextsObjectLiteral(sourceFile);
  return checkDomainContextShorthandBindingsInDomainBag(
    sourceFile,
    objectLiteral,
    "defineAppShellDomainContexts",
    checker,
  );
}

function isTypePosition(node) {
  let current = node.parent;
  while (current) {
    if (ts.isTypeNode(current) || ts.isExpressionWithTypeArguments(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isDeclarationIdentifier(node) {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) {
    return true;
  }
  if (ts.isVariableDeclaration(parent) && parent.name === node) {
    return true;
  }
  if (ts.isParameter(parent) && parent.name === node) {
    return true;
  }
  if (ts.isFunctionDeclaration(parent) && parent.name === node) {
    return true;
  }
  if (ts.isFunctionExpression(parent) && parent.name === node) {
    return true;
  }
  if (ts.isClassDeclaration(parent) && parent.name === node) {
    return true;
  }
  if (ts.isImportClause(parent) && parent.name === node) {
    return true;
  }
  if (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) {
    return true;
  }
  if (ts.isNamespaceImport(parent) && parent.name === node) {
    return true;
  }
  return false;
}

function isNestedFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function getCtxDestructureKeys(sourceFile, functionName, checker) {
  const fn = findFunctionDeclaration(sourceFile, functionName);
  const allKeys = new Set();
  const bindingSymbols = new Map();
  const bindingNameNodes = new Set();
  // ctx / legacyCtx 始终算 bag 读侧
  const bagDestructureIdentifiers = new Set(
    LEGACY_CONTEXT_DESTRUCTURE_IDENTIFIERS,
  );
  // 顶层参数（如 search section 的 input）仅在「非嵌套函数体」内算 bag 读侧
  // 避免 handleReorderWorkspaces(input) 内 `const { groupId } = input` 误报
  const topLevelParamNames = new Set(
    fn.parameters
      .filter((parameter) => ts.isIdentifier(parameter.name))
      .map((parameter) => parameter.name.text),
  );

  function considerDestructure(node, nestedFunctionDepth) {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isObjectBindingPattern(node.name) ||
      !node.initializer ||
      !ts.isIdentifier(node.initializer)
    ) {
      return;
    }
    const sourceName = node.initializer.text;
    const isBagId = bagDestructureIdentifiers.has(sourceName);
    const isTopLevelParam =
      nestedFunctionDepth === 0 && topLevelParamNames.has(sourceName);
    if (!isBagId && !isTopLevelParam) {
      return;
    }
    for (const element of node.name.elements) {
      if (element.dotDotDotToken) {
        continue;
      }
      if (!ts.isIdentifier(element.name)) {
        continue;
      }
      bindingNameNodes.add(element.name);
      const symbol = checker.getSymbolAtLocation(element.name);
      const key = element.propertyName
        ? getPropertyNameText(element.propertyName)
        : element.name.text;
      if (!key) {
        continue;
      }
      allKeys.add(key);
      if (symbol) {
        bindingSymbols.set(symbol, key);
      }
    }
  }

  function visitWithDepth(node, nestedFunctionDepth) {
    considerDestructure(node, nestedFunctionDepth);

    // 进入嵌套函数时 depth+1；根 fn 本身不在此递归入口
    if (isNestedFunctionLike(node) && node !== fn) {
      // 嵌套函数参数会遮蔽同名顶层 input，不再当 bag 源
      node.forEachChild((child) => visitWithDepth(child, nestedFunctionDepth + 1));
      return;
    }

    node.forEachChild((child) => visitWithDepth(child, nestedFunctionDepth));
  }

  if (!fn.body) {
    throw new Error(`Function "${functionName}" has no body.`);
  }
  fn.body.forEachChild((child) => visitWithDepth(child, 0));

  if (allKeys.size === 0) {
    throw new Error(`Cannot find context destructure in ${sourceFile.fileName}.`);
  }

  const usedKeys = new Set();
  visitNode(fn.body, (node) => {
    if (!ts.isIdentifier(node)) {
      return;
    }
    if (bindingNameNodes.has(node)) {
      return;
    }
    if (isDeclarationIdentifier(node) || isTypePosition(node)) {
      return;
    }
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) {
      return;
    }
    const key = bindingSymbols.get(symbol);
    if (!key) {
      return;
    }
    usedKeys.add(key);
  });

  // Fallback to all destructured keys if symbol analysis cannot find usages.
  if (usedKeys.size === 0) {
    return allKeys;
  }

  return usedKeys;
}

function getReturnObjectKeys(sourceFile, functionName) {
  const fn = findFunctionDeclaration(sourceFile, functionName);
  const keys = new Set();
  const sourceKeysByIdentifier = collectLocalObjectLiteralSourceKeys(fn.body);
  visitNode(fn.body, (node) => {
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isObjectLiteralExpression(node.expression)
    ) {
      for (const key of collectObjectLiteralEffectiveKeys(
        node.expression,
        sourceKeysByIdentifier,
      )) {
        keys.add(key);
      }
    }
  });

  if (keys.size === 0) {
    throw new Error(`Cannot find object literal return in function "${functionName}" (${sourceFile.fileName}).`);
  }
  return keys;
}

function getFirstCallArgument(sourceFile, calleeName) {
  let result = null;
  visitNode(sourceFile, (node) => {
    if (result) {
      return;
    }
    if (!ts.isCallExpression(node)) {
      return;
    }
    if (ts.isIdentifier(node.expression) && node.expression.text === calleeName) {
      result = node.arguments[0] ?? null;
    }
  });

  if (!result) {
    throw new Error(`Cannot find call "${calleeName}(...)".`);
  }
  return result;
}

function addSourceKeys(targetKeys, sourceKeys) {
  for (const key of sourceKeys) {
    targetKeys.add(key);
  }
}

function resolveProvidedKeysFromArgument(argumentNode, sourceSetsByIdentifier) {
  if (ts.isIdentifier(argumentNode)) {
    const keys = sourceSetsByIdentifier.get(argumentNode.text);
    if (!keys) {
      throw new Error(`Unknown argument source "${argumentNode.text}".`);
    }
    return { keys: new Set(keys), unresolvedSpreads: [] };
  }

  if (!ts.isObjectLiteralExpression(argumentNode)) {
    throw new Error(`Unsupported argument node kind: ${ts.SyntaxKind[argumentNode.kind]}.`);
  }

  const keys = new Set();
  const unresolvedSpreads = [];

  for (const property of argumentNode.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadExpr = property.expression;
      if (ts.isIdentifier(spreadExpr)) {
        const spreadKeys = sourceSetsByIdentifier.get(spreadExpr.text);
        if (!spreadKeys) {
          unresolvedSpreads.push(spreadExpr.text);
          continue;
        }
        for (const key of spreadKeys) {
          keys.add(key);
        }
        continue;
      }
      if (ts.isObjectLiteralExpression(spreadExpr)) {
        const nested = resolveProvidedKeysFromArgument(
          spreadExpr,
          sourceSetsByIdentifier,
        );
        for (const key of nested.keys) {
          keys.add(key);
        }
        unresolvedSpreads.push(...nested.unresolvedSpreads);
        continue;
      }
      unresolvedSpreads.push(spreadExpr.getText());
      continue;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      const sourceKeys = sourceSetsByIdentifier.get(property.name.text);
      if (sourceKeys) {
        addSourceKeys(keys, sourceKeys);
      } else {
        keys.add(property.name.text);
      }
      continue;
    }

    if (
      ts.isPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    ) {
      const key = getPropertyNameText(property.name);
      if (key) {
        const sourceKeys = sourceSetsByIdentifier.get(key);
        if (sourceKeys) {
          addSourceKeys(keys, sourceKeys);
          continue;
        }
        keys.add(key);
      }
    }
  }

  return { keys, unresolvedSpreads };
}

function sorted(items) {
  return [...items].sort((a, b) => a.localeCompare(b));
}

async function runNoUndefCheck() {
  const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: {
      env: {
        browser: true,
        es2021: true,
        node: true,
      },
      parser: "@typescript-eslint/parser",
      parserOptions: JSON.parse(PARSER_OPTIONS_JSON),
      rules: {
        "no-undef": "error",
      },
    },
    errorOnUnmatchedPattern: false,
  });

  const results = await eslint.lintFiles(CONTRACT_FILES);
  const errorCount = results.reduce((total, item) => total + item.errorCount, 0);
  if (errorCount > 0) {
    const formatter = await eslint.loadFormatter("stylish");
    const formatted = formatter.format(results);
    if (formatted) {
      console.error(formatted);
    }
    throw new Error("no-undef check failed.");
  }
}

function checkContract(contract) {
  const { name, requiredKeys, providedKeys, unresolvedSpreads } = contract;
  const issues = [];

  if (unresolvedSpreads.length > 0) {
    issues.push(
      `[${name}] unresolved spread source(s): ${sorted(unresolvedSpreads).join(", ")}`,
    );
  }

  const missingKeys = sorted(
    [...requiredKeys].filter((key) => !providedKeys.has(key)),
  );
  if (missingKeys.length > 0) {
    issues.push(`[${name}] missing ${missingKeys.length} key(s): ${missingKeys.join(", ")}`);
  }

  return issues;
}

async function main() {
  await runNoUndefCheck();

  const program = ts.createProgram({
    rootNames: CONTRACT_FILES.map((file) => toAbsolutePath(file)),
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();

  const appShellSource = getProgramSourceFile(program, APP_SHELL_FILE);
  const compositionSource = getProgramSourceFile(
    program,
    APP_SHELL_COMPOSITION_FILE,
  );
  const viewSource = getProgramSourceFile(program, APP_SHELL_VIEW_FILE);
  const assemblySource = getProgramSourceFile(
    program,
    APP_SHELL_DOMAIN_ASSEMBLY_FILE,
  );
  const searchSource = getProgramSourceFile(program, SEARCH_SECTION_FILE);
  const sectionsSource = getProgramSourceFile(program, SECTIONS_FILE);
  const layoutSource = getProgramSourceFile(program, LAYOUT_FILE);
  const renderSource = getProgramSourceFile(program, RENDER_FILE);

  // T1.1：bag 在 assembly 模块；app-shell 仅 useAppShellDomainAssembly 入参
  const appShellDomainContextKeySets =
    collectDomainContextKeySetsFromDefineCall(assemblySource);
  const appShellDomainContextShorthandIssues =
    checkDomainContextShorthandBindingsFromDefineCall(assemblySource, checker);
  const appShellDomainSourceSets = new Map([
    ["appShellDomainContexts", appShellDomainContextKeySets.allKeys],
    ...appShellDomainContextKeySets.domainKeys,
  ]);
  const searchReturnKeys = getReturnObjectKeys(
    searchSource,
    "useAppShellSearchAndComposerSection",
  );
  const sectionsReturnKeys = getReturnObjectKeys(
    sectionsSource,
    "useAppShellSections",
  );
  const layoutReturnKeys = getReturnObjectKeys(
    layoutSource,
    "useAppShellLayoutNodesSection",
  );

  const searchRequiredKeys = getCtxDestructureKeys(
    searchSource,
    "useAppShellSearchAndComposerSection",
    checker,
  );
  const sectionsRequiredKeys = getCtxDestructureKeys(
    sectionsSource,
    "useAppShellSections",
    checker,
  );
  const layoutRequiredKeys = getCtxDestructureKeys(
    layoutSource,
    "useAppShellLayoutNodesSection",
    checker,
  );
  const renderRequiredKeys = getCtxDestructureKeys(
    renderSource,
    "renderAppShell",
    checker,
  );

  // T2.4：searchAndComposerInput 分组字面量 → 展平组内 keys 作为 provided
  const searchAndComposerInputLiteral = getVariableObjectLiteral(
    compositionSource,
    "searchAndComposerInput",
  );
  const searchProvidedKeys = new Set();
  for (const property of searchAndComposerInputLiteral.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isObjectLiteralExpression(property.initializer)
    ) {
      for (const key of collectObjectLiteralOwnKeys(property.initializer)) {
        searchProvidedKeys.add(key);
      }
    }
  }
  const searchProvidedResolved = {
    keys: searchProvidedKeys,
    unresolvedSpreads: [],
  };

  // T2.6：section / layout / render 调用在 AppShellView
  const sectionsProvided = resolveProvidedKeysFromArgument(
    getFirstCallArgument(viewSource, "useAppShellSections"),
    new Map([
      ...appShellDomainSourceSets,
      ["searchAndComposerSection", searchReturnKeys],
    ]),
  );
  const layoutProvided = resolveProvidedKeysFromArgument(
    getFirstCallArgument(viewSource, "useAppShellLayoutNodesSection"),
    new Map([
      ...appShellDomainSourceSets,
      ["searchAndComposerSection", searchReturnKeys],
      ["sections", sectionsReturnKeys],
    ]),
  );
  const renderProvided = resolveProvidedKeysFromArgument(
    getFirstCallArgument(viewSource, "renderAppShell"),
    new Map([
      ...appShellDomainSourceSets,
      ["searchAndComposerSection", searchReturnKeys],
      ["sections", sectionsReturnKeys],
      ["layoutNodes", layoutReturnKeys],
    ]),
  );
  void appShellSource;

  const issues = [
    ...appShellDomainContextShorthandIssues,
    ...checkContract({
      name: "useAppShellSearchAndComposerSection",
      requiredKeys: searchRequiredKeys,
      providedKeys: searchProvidedResolved.keys,
      unresolvedSpreads: searchProvidedResolved.unresolvedSpreads,
    }),
    ...checkContract({
      name: "useAppShellSections",
      requiredKeys: sectionsRequiredKeys,
      providedKeys: sectionsProvided.keys,
      unresolvedSpreads: sectionsProvided.unresolvedSpreads,
    }),
    ...checkContract({
      name: "useAppShellLayoutNodesSection",
      requiredKeys: layoutRequiredKeys,
      providedKeys: layoutProvided.keys,
      unresolvedSpreads: layoutProvided.unresolvedSpreads,
    }),
    ...checkContract({
      name: "renderAppShell",
      requiredKeys: renderRequiredKeys,
      providedKeys: renderProvided.keys,
      unresolvedSpreads: renderProvided.unresolvedSpreads,
    }),
    ...checkNoProductionFullFlatten(),
  ];

  if (issues.length > 0) {
    console.error("check-app-shell-runtime-contract: FAILED");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log("check-app-shell-runtime-contract: OK");
}

/**
 * T5.4：生产路径禁止 full-flatten（flattenAppShellDomainContexts 调用）。
 * S4 PR-F：legacy flatten 已全量删除，零豁免——任何生产文件出现即违规
 * （测试文件本就豁免，不在扫描范围）。
 */
function checkNoProductionFullFlatten() {
  const root = path.resolve(process.cwd(), "src/app-shell");
  const issues = [];

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name) || name.includes(".test.")) continue;
      const source = readFileSync(full, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        if (
          line.includes("flattenAppShellDomainContexts(") &&
          !line.includes("flattenSelectedAppShellDomainContexts")
        ) {
          issues.push(
            `[full-flatten ban] ${path.relative(process.cwd(), full)}:${index + 1}: ${line.trim()}`,
          );
        }
        // 生产 consumer 不得调用 Legacy adapt（已删除，禁止复活）
        if (/adaptAppShellLegacyFlatContext\s*[<(]/.test(line)) {
          issues.push(
            `[legacy-adapt ban] ${path.relative(process.cwd(), full)}:${index + 1}: ${line.trim()}`,
          );
        }
      });
    }
  }

  walk(root);
  return issues;
}

try {
  await main();
} catch (error) {
  console.error(
    `check-app-shell-runtime-contract: FAILED\n- ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}
