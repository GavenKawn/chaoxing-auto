import React from 'react';
import { render } from 'ink';
import { App } from '../ui/App.js';

export const runCommand = async () => {
  // 渲染 Ink 应用
  const { waitUntilExit } = render(React.createElement(App));
  
  // 等待应用退出
  await waitUntilExit();
};
