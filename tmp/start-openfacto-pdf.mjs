import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';
const cwd=fileURLToPath(new URL('../apps/pdf-worker/',import.meta.url));
const python=fileURLToPath(new URL('../apps/pdf-worker/.venv/Scripts/python.exe',import.meta.url));
const child=spawn(python,['-m','openfacto_pdf'],{cwd,env:{...process.env,PDF_WORKER_HOST:'127.0.0.1'},stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('PDF worker failed to start');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
