const fs = require('fs');
const content = fs.readFileSync('node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift', 'utf8');
const lines = content.split('\n');

const stack = [];
let inMultilineComment = false;

lines.forEach((line, lineIdx) => {
  let inString = false;
  let lineNum = lineIdx + 1;
  
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i-1] : '';
    
    if (inMultilineComment) {
      if (c === '*' && line[i+1] === '/') {
        inMultilineComment = false;
        i++;
      }
      continue;
    }
    
    if (!inString && c === '/' && line[i+1] === '*') {
      inMultilineComment = true;
      i++;
      continue;
    }
    
    if (!inString && c === '/' && line[i+1] === '/') {
      break;
    }
    
    if (c === '"' && prev !== '\\') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (c === '{') {
        stack.push({ line: lineNum, text: line.trim() });
      } else if (c === '}') {
        if (stack.length === 0) {
          console.log(`Extra closing brace at line ${lineNum}: ${line}`);
        } else {
          const top = stack.pop();
        }
      }
    }
  }
});

console.log(`Unclosed blocks count: ${stack.length}`);
stack.forEach(s => console.log(`Unclosed at line ${s.line}: ${s.text}`));
