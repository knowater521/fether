// Copyright 2015-2018 Parity Technologies (UK) Ltd.
// This file is part of Parity.
//
// SPDX-License-Identifier: BSD-3-Clause

import { app } from 'electron';
import debug from 'debug';
import fs from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';

import { cli, parityArgv } from './utils/cli';
import { getParityPath } from './getParityPath';
import { isParityRunning } from './isParityRunning';
import logCommand from './utils/logCommand';
import { name } from '../package.json';

const logger = debug(`${name}:main`);

const fsChmod = promisify(fs.chmod);

let parity = null; // Will hold the running parity instance

// These are errors output by parity, which we should ignore (i.e. don't
// panic). They happen when an instance of parity is already running, and
// parity-electron tries to launch another one.
const catchableErrors = [
  'is already in use, make sure that another instance of an Ethereum client is not running',
  'IO error: While lock file:'
];

export const runParity = async mainWindow => {
  // Do not run parity with --no-run-parity
  if (cli.runParity === false) {
    return;
  }

  // Do not run parity if there is already another instance running
  const isRunning = await isParityRunning(mainWindow);
  if (isRunning) {
    return;
  }

  const parityPath = await getParityPath();

  // Some users somehow had no +x on the parity binary after downloading
  // it. We try to set it here (no guarantee it will work, we might not
  // have rights to do it).
  try {
    await fsChmod(parityPath, '755');
  } catch (e) {}

  let logLastLine; // Always contains last line of the Parity logs

  // Run an instance of parity with the correct args
  const args = [...parityArgv(), '--light'];
  parity = spawn(parityPath, args);
  logger(logCommand(parityPath, args));

  // Save in memory the last line of the log file, for handling error
  const callback = data => {
    if (data && data.length) {
      logLastLine = data.toString();
    }
    debug(`${name}:parity`)(data.toString());
  };
  parity.stdout.on('data', callback);
  parity.stderr.on('data', callback);

  parity.on('error', err => {
    throw err;
  });
  parity.on('close', (exitCode, signal) => {
    if (exitCode === 0) {
      return;
    }

    // When there's already an instance of parity running, then the log
    // is logging a particular line, see below. In this case, we just
    // silently ignore our local instance, and let the 1st parity
    // instance be the main one.
    if (
      logLastLine &&
      catchableErrors.some(error => logLastLine.includes(error))
    ) {
      logger('Another instance of parity is running, closing local instance.');
      return;
    }

    // If the exit code is not 0, then we show some error message
    if (Object.keys(parityArgv()).length > 0) {
      app.exit(1);
    } else {
      throw new Error(`Exit code ${exitCode}, with signal ${signal}.`);
    }
  });

  // Notify the renderers
  mainWindow.webContents.send('parity-running', true);
  global.isParityRunning = true; // Send this variable to renderes via IPC

  return Promise.resolve(true);
};

export const killParity = () => {
  if (parity) {
    debug('Stopping parity.');
    parity.kill();
    parity = null;
  }
  return Promise.resolve(true);
};
