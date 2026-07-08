import "../css/styles.css";
import '../pages/playground.html';

import sed from "../../src/index.js";

function stdinActive(){
  const checkbox = document.getElementById('enableStdin');
  return checkbox.checked === true;
}

function posixActive(){
  const checkbox = document.getElementById('enablePosix');
  return checkbox.checked === true;
}

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
            complex: `-i s/dev/prod/ config.json`,
            // Classic "join every line with a comma" idiom. Exercises N/branch
            // handling across the whole file (not just one line at a time) --
            // the label/branch and append-flush-timing fixes both live here.
            // Quoted via -e per fragment, same as the 'complex' example above --
            // an unquoted multi-line script with embedded spaces would mis-tokenize
            // here exactly like it would in a real unquoted shell command.
            branchjoin: `-e ':a' -e 'N' -e '$!ba' -e 's/\\n/, /g' myfile.txt`,
            // q/Q accept a custom exit code. Toggle "exitCode" reporting in
            // the terminal output shows this isn't just decorative -- it's
            // the actual process.exitCode a shell script would see from `$?`.
            exitcode: `2q5`,
        };

        // UI Logic
        const vfsMonitor = document.getElementById('vfsMonitor');
        const consoleLog = document.getElementById('consoleLog');
        const commandArea = document.getElementById('commandArea');
       const stdin = document.getElementById('stdin');
        const runBtn = document.getElementById('runBtn');
        const modeBadge = document.getElementById('modeBadge');

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
            const color = type === 'out' ? 'text-green-400' : (type === 'error' ? 'text-rose-400' : 'text-slate-400');
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

              const baseOptions = { vfs: myVfs, shell: hello, posix: posixActive(), exitCode: true };

              let result;
              if(stdinActive() === false){
                result = await sed(command, baseOptions);
              }else{
                result = await sed(command, { ...baseOptions, stdin: _stdin });
              }

              // With { exitCode: true }, sed() always returns { output, exitCode }
              // instead of a bare string -- unwrap it for display.
              const { output, exitCode } = result;
              const exitBadge = `<span class="text-slate-500">(exit ${exitCode})</span>`;

              if (output) {
                log(`${exitBadge} ${output}`, 'out');
              } else {
                // -i writes to the VFS instead of returning output; -n scripts
                // with no p/print commands also legitimately produce nothing.
                // Still show the exit code so q/Q-with-no-output isn't silent.
                log(`${exitBadge} <span class="italic text-slate-600">[no stdout -- check VFS panel for in-place changes]</span>`, 'out');
              }
              updateVFSDisplay();
            } catch (err) {
                const codeBadge = err.code !== undefined ? `[exit ${err.code}] ` : '';
                log(`${codeBadge}${err.message}`, 'error');
            }
        });

        // Init
        updateVFSDisplay();



 
  const checkbox = document.getElementById('enableStdin');
 
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

  const posixCheckbox = document.getElementById('enablePosix');
  const posixLabel = document.getElementById('posixLabel');

  posixCheckbox.addEventListener('change', (e) => {
    const isPosix = e.target.checked;
    if (isPosix) {
      modeBadge.textContent = 'POSIX Mode';
      modeBadge.classList.remove('bg-slate-800', 'border-slate-700');
      modeBadge.classList.add('bg-amber-900/30', 'text-amber-400', 'border-amber-800/50');
      posixLabel.classList.replace('text-slate-600', 'text-amber-400');
      log('Strict POSIX mode enabled -- GNU extensions (first~step, +N addresses, one-liner a/i/c text, s///I, etc.) will now be rejected.');
    } else {
      modeBadge.textContent = 'GNU Mode';
      modeBadge.classList.add('bg-slate-800', 'border-slate-700');
      modeBadge.classList.remove('bg-amber-900/30', 'text-amber-400', 'border-amber-800/50');
      posixLabel.classList.replace('text-amber-400', 'text-slate-600');
      log('GNU mode restored -- extensions re-enabled.');
    }
  });
