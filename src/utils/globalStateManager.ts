import * as vscode from 'vscode';
import { Identity, ResponseSchema, BaseAPI } from '../api/base';
import { SocketIOAPI } from '../api/socketio';
import { FileType, FolderEntity, MemberEntity } from '../provider/remoteFileSystemProvider';

const keyServerPersists: string = 'overleaf-servers';

export interface ProjectPersist {
    id: string;
    userId: string;
    name: string;
    lastUpdated?: string;
    lastUpdatedBy?: MemberEntity;
    source?: 'owner' | 'collaborator' | 'readOnly';
    accessLevel: 'owner' | 'collaborator' | 'readOnly';
    archived?: boolean;
    trashed?: boolean;
}

export interface ServerPersist {
    name: string;
    url: string;
    login?: {
        userId: string;
        username: string;
        identity: Identity;
        projects?: ProjectPersist[]
    };
}

interface ServerPersistMap {
    [name: string]: ServerPersist,
}

export class GlobalStateManager {

    static getServers(context:vscode.ExtensionContext) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        return Object.values(persists).map(persist => {
            return {
                server: persist,
                api: new BaseAPI(persist.url),
            };
        });
    }

    static addServer(context:vscode.ExtensionContext, name:string, url:string): boolean {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        if ( persists[name]===undefined ) {
            persists[name] = { name, url };
            context.globalState.update(keyServerPersists, persists);
            return true;
        } else {
            return false;
        }
    }

    static removeServer(context:vscode.ExtensionContext, name:string): boolean {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        if ( persists[name]!==undefined ) {
            delete persists[name];
            context.globalState.update(keyServerPersists, persists);
            return true;
        } else {
            return false;
        }
    }

    static async loginServer(context:vscode.ExtensionContext, api:BaseAPI, name:string, auth:{[key:string]:string}): Promise<boolean> {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login===undefined) {
            const res = auth.cookies ? await api.cookiesLogin(auth.cookies) : await api.passportLogin(auth.email, auth.password);
            if (res.type==='success' && res.identity!==undefined && res.message!==undefined) {
                server.login = {
                    userId: res.message,
                    username: auth.email,
                    identity: res.identity
                };
                context.globalState.update(keyServerPersists, persists);
                return true;
            } else {
                if (res.message!==undefined) {
                    vscode.window.showErrorMessage(res.message);
                }
                return false;
            }
        } else {
            return false;
        }
    }

    static async logoutServer(context:vscode.ExtensionContext, api:BaseAPI, name:string): Promise<boolean> {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            await api.logout(server.login.identity);
            delete server.login;
            context.globalState.update(keyServerPersists, persists);
            return true;
        } else {
            return false;
        }
    }

    static async fetchServerProjects(context:vscode.ExtensionContext, api:BaseAPI, name:string): Promise<ProjectPersist[]> {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            let res = await api.getProjectsJson(server.login.identity);
            if (res.type!=='success') {
                // fallback to `userProjectsJson`
                res = await api.userProjectsJson(server.login.identity);
            }
            if (res.type==='success' && res.projects!==undefined) {
                Object.values(res.projects).forEach(project => {
                    project.userId = (server.login as any).userId;
                });
                server.login.projects = res.projects;
                context.globalState.update(keyServerPersists, persists);
                return res.projects;
            } else {
                if (res.message!==undefined) {
                    vscode.window.showErrorMessage(res.message);
                }
                return [];
            }
        } else {
            return [];
        }
    }

    static authenticate(context:vscode.ExtensionContext, name:string) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];
        return server.login!==undefined ?
                Promise.resolve(server.login.identity):
                Promise.reject();
    }

    static async getProjectFile(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, fileId:string) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            const res = await api.getFile(server.login.identity, projectId, fileId);
            if (res.type==='success' && res.content!==undefined) {
                return res.content;
            } else {
                return new Uint8Array(0);
            }
        } else {
            return new Uint8Array(0);
        }
    }

    static async uploadProjectFile(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, parentFolderId:string, fileName:string, content:Uint8Array) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            const res = await api.uploadFile(server.login.identity, projectId, parentFolderId, fileName, content);
            if (res.type==='success' && res.entity!==undefined) {
                return res.entity;
            } else {
                if (res.message!==undefined) {
                    vscode.window.showErrorMessage(res.message);
                }
            }
        }
    }

    static async addProjectFolder(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, folderName:string, parentFolderId:string): Promise<FolderEntity|undefined> {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            const res = await api.addFolder(server.login.identity, projectId, folderName, parentFolderId);
            if (res.type==='success' && res.entity!==undefined) {
                return res.entity;
            } else {
                if (res.message!==undefined) {
                    vscode.window.showErrorMessage(res.message);
                }
            }
        }
        return;
    }

    static async deleteProjectEntity(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, fileType:FileType, fileId:string) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            const res = await api.deleteEntity(server.login.identity, projectId, fileType, fileId);
            if (res.type==='success') {
                return true;
            } else {
                if (res.message!==undefined) {
                    vscode.window.showErrorMessage(res.message);
                }
                return false;
            }
        } else {
            return false;
        }
    }

    static async renameProjectEntity(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, entityType:string, entityId:string, newName:string) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            const res = await api.renameEntity(server.login.identity, projectId, entityType, entityId, newName);
            if (res.type==='success') {
                return true;
            } else {
                if (res.message!==undefined) {
                    vscode.window.showErrorMessage(res.message);
                }
                return false;
            }
        } else {
            return false;
        }
    }

    static async moveProjectEntity(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, entityType:string, entityId:string, newParentId:string) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            const res = await api.moveEntity(server.login.identity, projectId, entityType, entityId, newParentId);
            if (res.type==='success') {
                return true;
            } else {
                if (res.message!==undefined) {
                    vscode.window.showErrorMessage(res.message);
                }
                return false;
            }
        } else {
            return false;
        }
    }

    static async compileProjectEntity(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, needCacheClearFirst:boolean) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];
        if (server.login!==undefined) {
            if (needCacheClearFirst){
                await api.deleteAuxFiles(server.login.identity, projectId);
            }
            const res = await api.compile(server.login.identity, projectId);
            if (res.type==='success') {
                return res.compile;
            } else {
                if (res.message!==undefined) {
                    vscode.window.showErrorMessage(res.message);
                }
                return undefined;
            }
        } else {
            return undefined;
        }
    }

    static async syncCode(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, filePath:string, line:number, column:number) {
        const identity = await this.authenticate(context, name);
        const res = await api.proxySyncCode(identity, projectId, filePath, line, column);
        if (res.type==='success') {
            return res.syncCode;
        } else {
            if (res.message!==undefined) {
                vscode.window.showErrorMessage(res.message);
            }
            return undefined;
        }
    }

    static async syncPdf(context:vscode.ExtensionContext, api:BaseAPI, name:string, projectId:string, page:number, h:number, v:number) {
        const identity = await this.authenticate(context, name);
        const res = await api.proxySyncPdf(identity, projectId, page, h, v);
        if (res.type==='success') {
            return res.syncPdf;
        } else {
            if (res.message!==undefined) {
                vscode.window.showErrorMessage(res.message);
            }
            return undefined;
        }
    }

    static initSocketIOAPI(context:vscode.ExtensionContext, name:string) {
        const persists = context.globalState.get<ServerPersistMap>(keyServerPersists, {});
        const server   = persists[name];

        if (server.login!==undefined) {
            const api = new BaseAPI(server.url);
            const socket = new SocketIOAPI(server.url, api, server.login.identity);
            return {api, socket};
        }
    }

}
