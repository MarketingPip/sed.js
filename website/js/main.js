import "../css/styles.css";
import '../pages/index.html';
function copyToClipboard() {
    const text = document.getElementById('installText').innerText;
    navigator.clipboard.writeText(text);
    alert('Command copied to clipboard!');
}
