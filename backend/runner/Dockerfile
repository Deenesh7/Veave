FROM mcr.microsoft.com/playwright:v1.58.2-noble

ENV NODE_PATH=/opt/veave-runner/node_modules \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER root
RUN mkdir -p /opt/veave-runner /runner /workspace \
    && npm install --prefix /opt/veave-runner --ignore-scripts --no-audit --no-fund --package-lock=false playwright@1.58.2 @babel/parser@7.29.9 sharp@0.34.4 \
    && chown pwuser:pwuser /workspace
COPY --chown=root:root browserValidation.cjs visualComparison.cjs worker.cjs registryProxy.cjs /runner/
RUN chmod -R a-w /runner /opt/veave-runner

USER pwuser
WORKDIR /workspace
ENTRYPOINT ["node", "/runner/worker.cjs"]
