import "../css/styles.css";
 
function copyToClipboard() {
    const text = document.getElementById('installText').innerText;
    navigator.clipboard.writeText(text);
    alert('Command copied to clipboard!');
}
