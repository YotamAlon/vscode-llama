// @ts-ignore 

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
  const vscode = acquireVsCodeApi();

  let response = '';

  // Handle messages sent from the extension to the webview
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "addResponse": {
        response = message.value;
        setResponse();
        break;
      }
      case "clearResponse": {
        response = '';
        break;
      }
    }
  });

  function fixCodeBlocks(response) {
  // Use a regular expression to find all occurrences of the substring in the string
  const REGEX_CODEBLOCK = new RegExp('\`\`\`', 'g');
  const matches = response.match(REGEX_CODEBLOCK);

  // Return the number of occurrences of the substring in the response, check if even
  const count = matches ? matches.length : 0;
  if (count % 2 === 0) {
    return response;
  } else {
    // else append ``` to the end to make the last code block complete
    return response.concat('\n\`\`\`');
  }

  }

  function setResponse() {
        var converter = new showdown.Converter({
          omitExtraWLInCodeBlocks: true, 
          simplifiedAutoLink: true,
          excludeTrailingPunctuationFromURLs: true,
          literalMidWordUnderscores: true,
          simpleLineBreaks: true
        });
        response = fixCodeBlocks(response);
        html = converter.makeHtml(response);
        document.getElementById("response").innerHTML = html;

        var preCodeBlocks = document.querySelectorAll("pre code");
        for (var i = 0; i < preCodeBlocks.length; i++) {
            preCodeBlocks[i].classList.add(
              "p-2",
              "my-2",
              "block"
            );
        }
        var codeBlocks = document.querySelectorAll('code');
        for (var i = 0; i < codeBlocks.length; i++) {
            // Check if innertext starts with "Copy code"
            if (codeBlocks[i].innerText.startsWith("Copy code")) {
                codeBlocks[i].innerText = codeBlocks[i].innerText.replace("Copy code", "");
            }

            codeBlocks[i].classList.add("p-1", "inline-flex", "max-w-full", "overflow-x-scroll", "border", "rounded-sm", "cursor-pointer");

            codeBlocks[i].addEventListener('click', function (e) {
                e.preventDefault();
                vscode.postMessage({
                    type: 'codeSelected',
                    value: this.innerText
                });
            });
        }
  }

  document.getElementById('prompt-input').addEventListener('keyup', function (e) {
    if (e.keyCode === 13) {
      vscode.postMessage({
        type: 'prompt',
        value: this.value
      });
    }
  });
})();