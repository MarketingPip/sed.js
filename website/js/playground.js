import "../css/styles.css";
import '../pages/playground.html';

import sed from "../../src/index.js";
 

        // Playground State
        let myVfs = {
            "notes.txt": "hello universe",
            "config.json": '{"mode": "dev"}',
           "myfile.txt": `hello foo bar baz
hello foo baz
world foo hello`
        };

        const snippets = {
            basic: `s/hello/hi/ notes.txt`,
            inplace: `-i s/universe/world/ notes.txt`,
            stdin: `s/a/b/g`, // set place holder "an apple a day"
            complex: `-i s/dev/prod/ config.json`
        };

        // UI Logic
        const vfsMonitor = document.getElementById('vfsMonitor');
        const consoleLog = document.getElementById('consoleLog');
        const commandArea = document.getElementById('commandArea');
       const stdin = document.getElementById('stdin');
        const runBtn = document.getElementById('runBtn');

        function updateVFSDisplay() {
            vfsMonitor.innerHTML = Object.entries(myVfs).map(([name, content]) => `
                <div class="bg-slate-950 p-3 rounded border border-slate-800">
                    <div class="text-indigo-400 text-xs mb-1 flex items-center gap-2">
                        <i class="far fa-file-code"></i> ${name}
                    </div>
                    <div class="text-slate-300 break-all">${content}</div>
                </div>
            `).join('');
        }

        function log(msg, type = 'info') {
            const div = document.createElement('div');
            const color = type === 'out' ? 'text-green-400' : 'text-slate-400';
            div.className =  `${color} whitespace-pre-wrap`
            div.innerHTML = `<span class="opacity-50 font-bold">${type === 'out' ? '➜' : '>'}</span> ${msg}`;
            consoleLog.appendChild(div);
            consoleLog.scrollTop = consoleLog.scrollHeight;
        }

        window.loadSnippet = (key) => {
            commandArea.value = snippets[key];
            log(`Loaded snippet: ${key}`);
        };

        window.clearConsole = () => { consoleLog.innerHTML = ''; };

        runBtn.addEventListener('click', async () => {
            try {
                const command = commandArea.value;
              
              const targetPath = command[command.length - 1];
              
               const _stdin = stdin.value;
               
                // Wrapping in an async IIFE to allow 'await' in the textarea
              // sed("s/hello/hi/", { vfs: myVfs, stdin: myVfs["notes.txt"] });
              
              async function hello(cmd){
                console.log(cmd)
               if(cmd === "whoami"){
                 return "user"
               }else{
                 return "unknown command"
               }
               
              }
               
              let result;
              if(!_stdin){
                result = await sed(command, { vfs: myVfs, shell:hello});
              }else{
                result = await sed(command, { stdin: _stdin, shell:hello});
              } 
              
               console.log(result.trim())
              
              //await sed(command)
                
                if (result) log(result, 'out');
                updateVFSDisplay();
            } catch (err) {
                log(err.message, 'error');
            }
        });

        // Init
        updateVFSDisplay();



 document.addEventListener('DOMContentLoaded', () => {
  const checkbox = document.getElementById('enableStdin');
  const stdin = document.getElementById('stdin');
  const statusLabel = document.getElementById('statusLabel');

  checkbox.addEventListener('change', (e) => {
    const isActive = e.target.checked;
    
    // Logic state
    stdin.readOnly = !isActive;
    
    // UI Visual states
    if (isActive) {
      stdin.classList.remove('opacity-40', 'grayscale', 'pointer-events-none', 'text-indigo-300/50');
      stdin.classList.add('text-indigo-300', 'border-slate-700');
      statusLabel.classList.replace('text-slate-600', 'text-indigo-400');
      stdin.focus();
    } else {
      stdin.classList.add('opacity-40', 'grayscale', 'pointer-events-none', 'text-indigo-300/50');
      stdin.classList.remove('text-indigo-300', 'border-slate-700');
      statusLabel.classList.replace('text-indigo-400', 'text-slate-600');
    }
  });
});

