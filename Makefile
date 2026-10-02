.PHONY: build test test-repository test-acceptance package clean

build:
	npm run build

test-repository:
	npm test

test-acceptance:
	npm run test:acceptance

test: test-repository test-acceptance

package:
	npm run test:vsix

clean:
	rm -rf dist
	rm -f protos-vscode.vsix protos-vscode.vsix.sha256
	rm -f /tmp/protos-vscode-extension-raw.vsix
	rm -f /tmp/protos-vscode-extension.vsix
	rm -rf /tmp/protos-vscode-acceptance
	rm -rf /tmp/protos-vscode-runtime
