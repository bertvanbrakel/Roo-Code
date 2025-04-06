import * as vscode from "vscode";
import * as nats from "nats";
import { v4 as uuidv4 } from "uuid";
import * as os from "os";
import * as fs from "fs";
import { logger } from "../../utils/logging";
import { exec } from "child_process";
import simpleGit, { SimpleGit } from 'simple-git';
import { NatsControlMessage, NatsCommandResponse, NatsInitializeRooCommand } from "../../shared/natsCommands"; // Import shared types

// Define the type for initial command data payload
type InitialCommandDataPayload = NatsInitializeRooCommand['payload'] | null;

/**
 * Service responsible for handling NATS messaging integration.
 * Follows a singleton pattern.
 */
class NatsService {
    private static instance: NatsService;

    private context: vscode.ExtensionContext | null = null;
    private natsConnection: nats.NatsConnection | null = null;
    private instanceId: string | null = null;
    private isConnected: boolean = false;
    private natsDisabled: boolean = false; // If true, NATS is permanently disabled for this session
    private autoStartedContainer: boolean = false; // Track if we started the Docker container

    // EventEmitter for dispatching received commands internally
    private readonly _onDidReceiveCommand = new vscode.EventEmitter<NatsControlMessage>();
    public readonly onDidReceiveCommand: vscode.Event<NatsControlMessage> = this._onDidReceiveCommand.event;

    private constructor() { }

    /**
     * Gets the singleton instance of the NatsService.
     */
    public static getInstance(): NatsService {
        if (!NatsService.instance) {
            NatsService.instance = new NatsService();
        }
        return NatsService.instance;
    }

    /**
     * Initializes the NATS service. Must be called during extension activation.
     */
    public async initialize(context: vscode.ExtensionContext): Promise<InitialCommandDataPayload> {
        if (this.instanceId || this.natsDisabled) {
             logger.debug(`NATS Service already initialized or disabled (InstanceID: ${this.instanceId}, Disabled: ${this.natsDisabled})`);
             return null;
        }
        this.context = context;
        const config = vscode.workspace.getConfiguration("roo.nats");
        const enabled = config.get<boolean>("enabled", false);

        if (!enabled) {
            logger.info("NATS integration is disabled via configuration.");
            this.natsDisabled = true;
            return null;
        }

        logger.info("Initializing NATS Service...");

        try {
            // 1. Determine Instance ID
            this.instanceId = await this.determineInstanceId();
            if (!this.instanceId) {
                throw new Error("Failed to establish NATS instanceId.");
            }
            logger.info(`NATS Service using instanceId: ${this.instanceId}`);

            // 2. Optional Docker Auto-Start Logic
            if (config.get<boolean>("autoStartLocalServer", false)) {
                 await this.tryAutoStartNatsServer(config);
            }

            // 3. Attempt Connection
            await this.connectToNats(); // Includes auth, listeners, and startup msg publish

            // 4. Wait for initial command (if connected)
            const initialCommandTimeoutMs = config.get<number>("initialCommandTimeoutMs", 5000);
            const initialCommandPayload = this.isConnected ? await this.waitForInitialCommand(initialCommandTimeoutMs) : null;

            // 5. Setup regular subscriptions (if connected)
            if (this.isConnected) {
                this.setupSubscriptions();
            }

            logger.info(`NATS Service Initialized. Connected: ${this.isConnected}`);
            return initialCommandPayload;

        } catch (error: any) {
            logger.error(`NATS Service initialization failed: ${error.message}`);
            this.natsDisabled = true;
            this.instanceId = null;
            return null;
        }
    }

    /**
     * Determines the persistent instanceId based on environment variables and files.
     */
    private async determineInstanceId(): Promise<string | null> {
        const directInstanceId = process.env.ROO_INSTANCE_ID;
        if (directInstanceId) {
            logger.debug("Using direct instanceId from ROO_INSTANCE_ID environment variable.");
            return directInstanceId;
        }

        const machineId = process.env.ROO_MACHINE_ID || await this.getMachineIdComponent();
        const projectId = process.env.ROO_PROJECT_ID || await this.getProjectIdComponent();

        if (machineId && projectId) {
            return `${machineId}-${projectId}`;
        } else {
            logger.error("Could not determine both machineId and projectId components.");
            return null;
        }
    }

    /**
     * Gets or generates the machine-specific ID component.
     */
    private async getMachineIdComponent(): Promise<string | null> {
        if (!this.context) {
            logger.error("Extension context not available for machine ID retrieval.");
            return null;
        }
        const machineIdDirUri = vscode.Uri.joinPath(this.context.globalStorageUri, 'roo');
        const machineIdFileUri = vscode.Uri.joinPath(machineIdDirUri, 'machine.id');
        logger.debug(`Checking for machine ID at: ${machineIdFileUri.fsPath}`);

        try {
             await vscode.workspace.fs.createDirectory(machineIdDirUri);
             logger.debug(`Ensured global storage directory exists: ${machineIdDirUri.fsPath}`);

            const contentBytes = await vscode.workspace.fs.readFile(machineIdFileUri);
            const id = Buffer.from(contentBytes).toString('utf8').trim();
            if (id) {
                 logger.debug(`Read existing machine ID: ${id}`);
                 return id;
            }
             logger.warn("Machine ID file exists but is empty. Generating new ID.");
        } catch (error: any) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                logger.info("Machine ID file not found. Generating new ID.");
            } else {
                logger.warn(`Error reading machine ID file: ${error.message}. Proceeding to generate new ID.`);
            }
        }

        const newId = uuidv4();
        try {
            await vscode.workspace.fs.writeFile(machineIdFileUri, Buffer.from(newId, 'utf8'));
            logger.info(`Generated and wrote new machine ID: ${newId}`);
            return newId;
        } catch (writeError: any) {
            logger.error(`Failed to write machine ID file: ${writeError.message}`);
            return null;
        }
    }

    /**
     * Gets or generates the project-specific ID component.
     * Also handles the .gitignore update.
     */
    private async getProjectIdComponent(): Promise<string | null> {
        const projectPath = process.cwd();
        if (!projectPath) {
             logger.warn("Could not determine project path (process.cwd()). Cannot establish project ID.");
             return null;
        }
        const projectDirUri = vscode.Uri.file(projectPath);
        const rooDirUri = vscode.Uri.joinPath(projectDirUri, '.roo');
        const projectIdFileUri = vscode.Uri.joinPath(rooDirUri, 'instance.id');
        logger.debug(`Checking for project ID at: ${projectIdFileUri.fsPath}`);
        let createdNewId = false;

        try {
             await vscode.workspace.fs.createDirectory(rooDirUri);
             logger.debug(`Ensured project .roo directory exists: ${rooDirUri.fsPath}`);

            const contentBytes = await vscode.workspace.fs.readFile(projectIdFileUri);
            const id = Buffer.from(contentBytes).toString('utf8').trim();
            if (id) {
                 logger.debug(`Read existing project ID: ${id}`);
                 return id;
            }
             logger.warn("Project ID file exists but is empty. Generating new ID.");
        } catch (error: any) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                logger.info("Project ID file not found. Generating new ID.");
            } else {
                logger.warn(`Error reading project ID file: ${error.message}. Proceeding to generate new ID.`);
            }
        }

        const newId = uuidv4();
        try {
            await vscode.workspace.fs.writeFile(projectIdFileUri, Buffer.from(newId, 'utf8'));
            logger.info(`Generated and wrote new project ID: ${newId}`);
            createdNewId = true;
            if (createdNewId) {
                 await this.updateGitignore(projectDirUri);
            }
            return newId;
        } catch (writeError: any) {
            logger.error(`Failed to write project ID file: ${writeError.message}`);
            return null;
        }
    }

    /**
     * Attempts to add '.roo/' to the project's .gitignore file.
     */
    private async updateGitignore(projectDirUri: vscode.Uri): Promise<void> {
        const gitignoreUri = vscode.Uri.joinPath(projectDirUri, '.gitignore');
        const entryToadd = '.roo/';
        logger.debug(`Checking/updating ${gitignoreUri.fsPath} for ${entryToadd}`);

        try {
            let gitignoreContent = "";
            let needsUpdate = false;

            try {
                const contentBytes = await vscode.workspace.fs.readFile(gitignoreUri);
                gitignoreContent = Buffer.from(contentBytes).toString('utf8');
                if (!gitignoreContent.split('\n').some(line => line.trim() === entryToadd)) {
                    needsUpdate = true;
                    if (gitignoreContent.length > 0 && !gitignoreContent.endsWith('\n')) {
                        gitignoreContent += '\n';
                    }
                    gitignoreContent += `${entryToadd}\n`;
                } else {
                     logger.debug(`'${entryToadd}' already present in .gitignore.`);
                }
            } catch (readError: any) {
                 if (readError instanceof vscode.FileSystemError && readError.code === 'FileNotFound') {
                     logger.info(".gitignore not found, creating new one.");
                     gitignoreContent = `${entryToadd}\n`;
                     needsUpdate = true;
                 } else {
                     throw readError;
                 }
            }

            if (needsUpdate) {
                await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(gitignoreContent, 'utf8'));
                logger.info(`Successfully added '${entryToadd}' to ${gitignoreUri.fsPath}`);
                vscode.window.showInformationMessage(`Added '${entryToadd}' to .gitignore.`);
            }
        } catch (error: any) {
            logger.warn(`Failed to automatically update .gitignore with '${entryToadd}': ${error.message}. Please add it manually.`);
        }
    }

    /**
     * Creates the NatsConnectionOptions based on configuration settings and env vars.
     */
    private getConnectOptions(): nats.ConnectionOptions {
        const config = vscode.workspace.getConfiguration("roo.nats");
        const options: nats.ConnectionOptions = {
            servers: config.get<string>("serverUrl", "nats://localhost:4222"),
            reconnect: true,
            maxReconnectAttempts: -1,
            waitOnFirstConnect: true,
        };

        // Authentication Priority:
        const credsFile = config.get<string>("credentialsFile", "");
        if (credsFile) {
            try {
                logger.info("Using NATS credentials file for authentication.");
                const credsContent = fs.readFileSync(credsFile, { encoding: 'utf-8' });
                options.authenticator = nats.credsAuthenticator(Buffer.from(credsContent));
                return options;
            } catch (e: any) {
                 logger.error(`Error reading NATS credentials file '${credsFile}': ${e.message}`);
            }
        }

        const authToken = config.get<string>("authToken", "") || process.env.NATS_TOKEN;
        if (authToken) {
            logger.info("Using NATS token for authentication.");
            options.token = authToken;
            return options;
        }

        const nkeySeed = process.env.NATS_NKEY;
        if (nkeySeed) {
            try {
                logger.info("Using NATS NKey seed for authentication.");
                options.authenticator = nats.nkeyAuthenticator(nats.nkeys.decodeSeed(Buffer.from(nkeySeed)));
                return options;
            } catch (e: any) {
                logger.error(`Invalid NATS_NKEY provided: ${e.message}`);
            }
        }

        const userJwt = process.env.NATS_JWT;
        if (userJwt) {
            logger.warn("NATS_JWT authentication without NKey signature callback is not fully supported. Use credentials file or NKey instead.");
        }

        const user = config.get<string>("authUser", "") || process.env.NATS_USER;
        const pass = config.get<string>("authPassword", "") || process.env.NATS_PW;
        if (user && pass) {
            logger.info("Using NATS username/password for authentication.");
            options.user = user;
            options.pass = pass;
            return options;
        }

        logger.info("Using anonymous NATS authentication.");
        return options;
    }

    /**
     * Establishes the connection to the NATS server and sets up listeners.
     */
    private async connectToNats(): Promise<void> {
        if (this.natsConnection || this.natsDisabled) {
            logger.debug("NATS connection already established or service disabled.");
            return;
        }

        const connectOptions = this.getConnectOptions();
        logger.info(`Attempting to connect to NATS server(s): ${connectOptions.servers}`);

        try {
            this.natsConnection = await nats.connect(connectOptions);
            this.isConnected = true;
            logger.info(`Successfully connected to NATS server: ${this.natsConnection.getServer()}`);
            this.setupConnectionListeners();
            await this.publishStartupInfo();
        } catch (err: any) {
            logger.error(`NATS connection failed: ${err.message}`);
            if (err.code === nats.ErrorCode.AuthenticationExpired || err.code === nats.ErrorCode.AuthorizationViolation) {
                logger.error("Disabling NATS due to fatal authentication/authorization error.");
                this.natsDisabled = true;
            }
            this.natsConnection = null;
            this.isConnected = false;
            throw err;
        }
    }

    /**
     * Sets up listeners for NATS connection events.
     */
    private async setupConnectionListeners(): Promise<void> {
        if (!this.natsConnection) return;

        (async () => {
            for await (const status of this.natsConnection!.status()) {
                switch (status.type) {
                    case nats.Events.Disconnect:
                        logger.warn(`NATS disconnected. Data: ${JSON.stringify(status.data)}`);
                        this.isConnected = false;
                        break;
                    case nats.Events.Reconnect:
                        logger.info(`NATS reconnected. Data: ${JSON.stringify(status.data)}. Re-establishing subscriptions...`);
                        this.isConnected = true;
                        // TODO: Re-establish subscriptions if necessary
                        this.setupSubscriptions(); // Attempt to re-subscribe on reconnect
                        // TODO: Publish a status update event?
                        break;
                    case nats.Events.Error: {
                        const err = status.data as unknown as nats.NatsError;
                        if (err && typeof err.message === 'string') {
                            logger.error(`NATS client error: ${err.message} (Code: ${err.code})`);
                            if (err.code === nats.ErrorCode.PermissionsViolation || err.code === nats.ErrorCode.AuthenticationExpired) {
                                logger.error(`Disabling NATS due to fatal error: ${err.code}.`);
                                this.natsDisabled = true;
                                this.shutdown(); // Don't await
                            }
                        } else {
                            logger.error(`NATS client error: Unknown error structure. Data: ${JSON.stringify(status.data)}`);
                        }
                        break;
                    }
                    default:
                        logger.debug(`NATS status event: ${status.type}`, { data: status.data });
                }
            }
        })().catch((err) => {
            logger.error(`NATS status listener error: ${err}`);
        });

        this.natsConnection.closed().then((err) => {
            logger.warn(`NATS connection closed permanently. ${err ? `Error: ${err.message}` : ''}`);
            this.isConnected = false;
            this.natsConnection = null;
        }).catch((err) => {
             logger.error(`Error handling NATS closed promise: ${err}`);
        });
    }

    /**
     * Attempts to start a NATS server using Docker if configured and needed.
     */
    private async tryAutoStartNatsServer(config: vscode.WorkspaceConfiguration): Promise<void> {
        const serverUrl = config.get<string>("serverUrl", "nats://localhost:4222");
        const natsPort = 4222; // TODO: Parse from serverUrl or make configurable?
        const containerName = "roo-nats-server";

        if (!serverUrl.includes("localhost") && !serverUrl.includes("127.0.0.1")) {
            logger.debug("NATS server URL is not localhost, skipping Docker auto-start.");
            return;
        }

        try {
            const ncTest = await nats.connect({ servers: serverUrl, timeout: 500, maxReconnectAttempts: 0 });
            await ncTest.close();
            logger.info("Existing NATS server detected on localhost, skipping Docker auto-start.");
            return;
        } catch (e) {
            logger.info("No running NATS server detected on localhost, attempting Docker auto-start...");
        }

        try {
            await this.executeShellCommand("docker info");
            logger.debug("Docker daemon is running.");
        } catch (dockerError: any) {
            logger.error(`Docker check failed: ${dockerError.message}. Cannot auto-start NATS server. Please start Docker or disable auto-start.`);
            return;
        }

        const dockerCommand = `docker run --rm -d -p ${natsPort}:${natsPort} --name ${containerName} nats:latest`;
        logger.info(`Executing Docker command: ${dockerCommand}`);
        try {
            await this.executeShellCommand(dockerCommand);
            this.autoStartedContainer = true; // Mark that we started it
            logger.info(`Successfully requested Docker container start for ${containerName}. Waiting briefly...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (startError: any) {
             if (startError.message?.includes('container name "/roo-nats-server" is already in use')) {
                  logger.warn(`Docker container '${containerName}' already exists. Assuming it's running or starting.`);
             } else {
                  logger.error(`Failed to start NATS Docker container: ${startError.message}`);
             }
        }
    }

    /**
     * Executes a shell command and returns a promise resolving with stdout or rejecting on error.
     */
    private executeShellCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Command failed: ${error.message}\nStderr: ${stderr}`));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    /**
     * Publishes the startup event after successful connection.
     */
    private async publishStartupInfo(): Promise<void> {
        if (!this.instanceId || !this.isConnected) return;

        let gitRepo: string | undefined;
        let gitBranch: string | undefined;
        try {
            const git: SimpleGit = simpleGit(process.cwd());
            if (await git.checkIsRepo()) {
                gitRepo = (await git.remote(['get-url', 'origin']))?.trim();
                gitBranch = (await git.branchLocal()).current;
            }
        } catch (gitError: any) {
            logger.warn(`Could not retrieve Git info: ${gitError.message}`);
        }

        const startupData = {
            timestamp: new Date().toISOString(),
            ide: "vscode",
            hostname: os.hostname(),
            cwd: process.cwd(),
            gitRepo: gitRepo,
            gitBranch: gitBranch,
            instanceId: this.instanceId,
        };
        const subject = `roo.${this.instanceId}.events.startup`;
        this.publish(subject, startupData);
        logger.info("Published NATS startup event.");
    }

    /**
     * Publishes a message to a NATS subject if connected.
     */
    public publish(subject: string, payload: any): void {
        if (this.natsDisabled || !this.isConnected || !this.natsConnection) {
            logger.debug(`NATS publish skipped (Disabled: ${this.natsDisabled}, Connected: ${this.isConnected}) for subject: ${subject}`);
            return;
        }
        try {
            const codec = nats.JSONCodec();
            this.natsConnection.publish(subject, codec.encode(payload));
            logger.debug(`Published NATS message to ${subject}`);
        } catch (error: any) {
            logger.error(`Failed to publish NATS message to ${subject}: ${error.message}`);
        }
    }

    /**
     * Publishes the command response back to NATS.
     */
    public publishCommandResponse(response: NatsCommandResponse): void {
        if (!this.instanceId || !response.correlationId) return;
        const subject = `roo.${this.instanceId}.control.command_response`;
        this.publish(subject, response);
    }

    /**
     * Waits for the initial command after connection.
     */
    private async waitForInitialCommand(timeoutMs: number): Promise<InitialCommandDataPayload> {
        if (!this.isConnected || !this.natsConnection || !this.instanceId) return null;
        logger.debug(`Waiting for initial NATS command (Timeout: ${timeoutMs}ms)...`);

        const subject = `roo.${this.instanceId}.control.initial_command`;
        let subscription: nats.Subscription | null = null;
        let timer: NodeJS.Timeout | null = null;

        const promise = new Promise<InitialCommandDataPayload>((resolve) => {
            try {
                 subscription = this.natsConnection!.subscribe(subject, {
                     max: 1,
                     callback: (err, msg) => {
                         if (timer) clearTimeout(timer);
                         if (err) {
                             logger.error(`Error receiving initial command on ${subject}: ${err.message}`);
                             resolve(null);
                         } else {
                             try {
                                 const codec = nats.JSONCodec();
                                 const command = codec.decode(msg.data) as NatsInitializeRooCommand; // Use specific type
                                 logger.info(`Received initial command on ${subject}`);
                                 // Basic validation
                                 if (command && command.command === 'initialize_roo' && typeof command.payload === 'object') {
                                     resolve(command.payload ?? null);
                                 } else {
                                     logger.warn(`Received invalid initial command structure on ${subject}`);
                                     resolve(null);
                                 }
                             } catch (decodeError: any) {
                                 logger.error(`Failed to decode initial command on ${subject}: ${decodeError.message}`);
                                 resolve(null);
                             }
                         }
                     },
                 });

                 timer = setTimeout(() => {
                     logger.debug(`Timeout waiting for initial command on ${subject}.`);
                     subscription?.unsubscribe();
                     resolve(null);
                 }, timeoutMs);

            } catch (subError: any) {
                 logger.error(`Failed to subscribe for initial command on ${subject}: ${subError.message}`);
                 if (timer) clearTimeout(timer);
                 resolve(null);
            }
        });

        promise.finally(() => {
             if (timer) clearTimeout(timer);
             subscription?.unsubscribe();
        });

        return promise;
    }

    /**
     * Sets up regular NATS subscriptions.
     */
    private setupSubscriptions(): void {
        if (this.natsDisabled || !this.isConnected || !this.natsConnection || !this.instanceId) {
            logger.debug("Subscription setup skipped (Disabled, not connected, or no instanceId).");
            return;
        }
        logger.info("Setting up regular NATS subscriptions...");

        const subjectsToSubscribe = [
             `roo.${this.instanceId}.control.command`,
             `roo.${this.instanceId}.control.set_rule`,
             `roo.${this.instanceId}.control.delete_rule`,
             `roo.${this.instanceId}.control.set_fact`,
             `roo.${this.instanceId}.control.delete_fact`,
        ];

        for (const subject of subjectsToSubscribe) {
             try {
                 const sub = this.natsConnection.subscribe(subject);
                 logger.debug(`Subscribed to ${subject}`);
                 (async () => {
                     for await (const msg of sub) {
                         this.handleIncomingNatsMessage(msg);
                     }
                     logger.debug(`Subscription closed for ${subject}`);
                 })().catch(err => logger.error(`Subscription error for ${subject}: ${err.message}`));
             } catch (subError: any) {
                  logger.error(`Failed to subscribe to ${subject}: ${subError.message}`);
             }
        }
    }

    /**
     * Handles incoming raw NATS messages from regular subscriptions.
     */
    private handleIncomingNatsMessage(msg: nats.Msg): void {
        logger.debug(`Received NATS message on ${msg.subject}`);
        try {
            const codec = nats.JSONCodec();
            const potentialPayload = codec.decode(msg.data);
            if (!potentialPayload || typeof potentialPayload !== 'object' || typeof (potentialPayload as any).command !== 'string') {
                logger.warn(`Received invalid NATS message structure on ${msg.subject}. Payload: ${JSON.stringify(potentialPayload)}`);
                return;
            }

            const payload = potentialPayload as NatsControlMessage;

            // TODO: Add more specific validation based on payload.command if needed

            this._onDidReceiveCommand.fire(payload);
            logger.debug(`Dispatching command: ${payload.command}`);

        } catch (error: any) {
            logger.error(`Failed to decode/handle NATS message on ${msg.subject}: ${error.message}`);
        }
    }

    /**
     * Gracefully shuts down the NATS connection.
     */
    public async shutdown(): Promise<void> {
        logger.info("Shutting down NATS Service...");
        await this.stopAutoStartedNatsServer();

        if (this.natsConnection) {
            try {
                await this.natsConnection.drain();
                logger.info("NATS connection drained.");
                if (!this.natsConnection.isClosed()) {
                     await this.natsConnection.close();
                     logger.info("NATS connection closed.");
                }
            } catch (error: any) {
                logger.error(`Error draining/closing NATS connection: ${error.message}`);
            } finally {
                this.natsConnection = null;
                this.isConnected = false;
            }
        }
        this.instanceId = null;
        this.natsDisabled = false;
        this._onDidReceiveCommand?.dispose();
    }

    /**
     * Stops the auto-started NATS Docker container if it was started by this service.
     */
     private async stopAutoStartedNatsServer(): Promise<void> {
        if (this.autoStartedContainer) {
            const containerName = "roo-nats-server";
            logger.info(`Attempting to stop auto-started Docker container: ${containerName}`);
            try {
                await this.executeShellCommand(`docker stop ${containerName}`);
                logger.info(`Successfully stopped Docker container: ${containerName}`);
            } catch (stopError: any) {
                 if (!stopError.message?.includes('No such container')) {
                      logger.warn(`Failed to stop Docker container '${containerName}': ${stopError.message}`);
                 } else {
                      logger.debug(`Docker container '${containerName}' not found or already stopped/removed.`);
                 }
            } finally {
                 this.autoStartedContainer = false;
            }
        }
     }
}

// Export the singleton instance
export const natsService = NatsService.getInstance();