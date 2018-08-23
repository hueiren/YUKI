import { app, ipcMain, dialog } from "electron";
import { exec } from "child_process";
import types from "../../common/ipcTypes";
import logger from "../../common/logger";
import defaultConfig from "../config/default";
import gamesConfig from "../config/games";
import { hooker } from "../../common/hooker";
const tasklist = require("tasklist");

let hookerStarted = false;

let runningGame: any = {};

export default function(mainWindow: Electron.BrowserWindow) {
  ipcMain.on(types.MAIN_PAGE_LOAD_FINISHED, () => {
    if (!hookerStarted) {
      logger.info(`main page load finished.`);

      hooker.start();
      hooker.onThreadCreate(
        (tt: Yagt.TextThread) => {
          logger.debug("thread created: ");
          logger.debug(tt);
          mainWindow.webContents.send(types.HAS_INSERTED_HOOK, tt);
        },
        (tt: Yagt.TextThread, text: string) => {
          logger.debug(`get text [${tt.num}]: ${text}`);
          mainWindow.webContents.send(types.HAS_HOOK_TEXT, tt, text);
        }
      );
      hooker.onThreadRemove((tt: Yagt.RemovedTextThread) => {
        logger.debug("thread removed: ");
        logger.debug(tt);
        mainWindow.webContents.send(types.HAS_REMOVED_HOOK, tt);
      });
      hooker.open();
      hookerStarted = true;
    }
  });

  ipcMain.on(
    types.REQUEST_RUN_GAME,
    (event: Electron.Event, game: Yagt.Game) => {
      let execString = "";
      const localeChangers = defaultConfig.get().localeChanger;
      for (let key in localeChangers) {
        if (localeChangers[key].enabled === true) {
          execString = localeChangers[key].exec;
          logger.debug(`choose ${key} as locale changer`);
          break;
        }
      }
      if (execString === "") {
        logger.error("no valid locale changer");
        return;
      }

      execString = execString.replace("%GAME_PATH%", `"${game.path}"`);
      logger.debug(`exec string: ${execString}`);

      exec(execString);
      let tryGetProcess = setInterval(() => {
        tasklist().then((tasks: any) => {
          let gameProcess = tasks.find(
            (task: any) =>
              task.imageName ===
              game.path.substring(game.path.lastIndexOf("\\") + 1)
          );
          if (gameProcess !== undefined) {
            clearInterval(tryGetProcess);
            //get process, inject it!
            runningGame = gameProcess;
            logger.debug(`get running game: ${JSON.stringify(runningGame)}`);
            logger.debug(`injecting process ${runningGame.pid}...`);
            hooker.injectProcess(runningGame.pid);
            logger.debug(`process ${runningGame.pid} injected`);

            if (game.code !== "") {
              logger.debug(
                `inserting hook ${game.code} to process ${runningGame.pid}...`
              );
              hooker.insertHook(runningGame.pid, game.code);
              logger.debug(`hook ${game.code} inserted`);
            }
          }
        });
        // logger.debug(`detaching process ${runningGame.pid}...`);
        // hooker.detachProcess(runningGame.pid);
        // logger.debug(`process ${runningGame.pid} detached`);
        // logger.debug(`game [${runningGame.pid}] exited`);
        // runningGame.pid = -1;
      }, 500);
    }
  );

  ipcMain.on(
    types.REQUEST_INSERT_HOOK,
    (event: Electron.Event, code: string) => {
      logger.debug(`inserting hook ${code} to process ${runningGame.pid}...`);
      hooker.insertHook(runningGame.pid, code);
      logger.debug(`hook ${code} inserted`);
    }
  );

  ipcMain.on(
    types.REQUEST_REMOVE_HOOK,
    (event: Electron.Event, thread: Yagt.TextThread) => {
      logger.debug(
        `removing hook ${thread.hook} from process ${runningGame.pid}...`
      );
      hooker.removeHook(runningGame.pid, thread.hook);
      logger.debug(`hook ${thread.hook} removed`);
    }
  );

  ipcMain.on(types.REQUEST_CONFIG, (event: Electron.Event, name: string) => {
    let configFileName = `config/${name}.yml`;
    logger.debug(`request config ${configFileName}`);
    switch (name) {
      case "default":
        event.sender.send(types.HAS_CONFIG, name, defaultConfig.get());
        break;
      case "games":
        event.sender.send(types.HAS_CONFIG, name, gamesConfig.get().games);
        break;
      default:
        logger.error(`invalid config name: ${name}`);
        break;
    }
  });

  ipcMain.on(
    types.REQUEST_SAVE_CONFIG,
    (event: Electron.Event, name: string, cfg: any) => {
      let configFileName = `config/${name}.yml`;
      logger.debug(`request saving config ${configFileName}: `);
      logger.debug(cfg);

      switch (name) {
        case "default":
          defaultConfig.set(cfg);
          defaultConfig.save();
          logger.debug(`config ${configFileName} saved`);
          event.sender.send(types.HAS_CONFIG, name, defaultConfig.get());
          break;
        case "games":
          gamesConfig.set(cfg);
          gamesConfig.save();
          logger.debug(`config ${configFileName} saved`);
          event.sender.send(types.HAS_CONFIG, name, gamesConfig.get());
          break;
        default:
          logger.error(`invalid config name: ${name}`);
          break;
      }
    }
  );

  ipcMain.on(
    types.REQUEST_ADD_GAME,
    (event: Electron.Event, game: Yagt.Game) => {
      gamesConfig.get().games.push(game);
      gamesConfig.save();
      event.sender.send(types.HAS_CONFIG, "games", gamesConfig.get().games);
      event.sender.send(types.HAS_ADDED_GAME);
    }
  );

  ipcMain.on(types.REQUEST_NEW_GAME_PATH, (event: Electron.Event) => {
    dialog.showOpenDialog(
      {
        properties: ["openFile"],
        filters: [{ name: "可执行文件", extensions: ["exe"] }]
      },
      files => {
        if (files[0]) {
          event.sender.send(types.HAS_NEW_GAME_PATH, files[0]);
        }
      }
    );
  });

  ipcMain.on(types.APP_EXIT, (event: Electron.Event) => {
    logger.debug("saving configurtion to file...");
    //TODO: save configuration to file
    logger.info("app exited");
    app.exit(0);
  });
}
