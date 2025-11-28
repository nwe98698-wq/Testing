const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const crypto = require('crypto');

// Bot configuration
const BOT_TOKEN = "7968178268:AAHQ8umR_AhNvynfD2VcUbtDEp12DFHM8hc";
const CHANNEL_USERNAME = "@Vipsafesingalchannel298";
const CHANNEL_LINK = "https://t.me/Vipsafesingalchannel298";
const ADMIN_USER_ID = "6328953001";

// API endpoints
const API_ENDPOINTS = {
    "777": "https://api.bigwinqaz.com/api/webapi/",
    "TRX": "https://api.bigwinqaz.com/api/webapi/"
};

// Colour Bet Types
const COLOUR_BET_TYPES = {
    "RED": 10,
    "GREEN": 11,
    "VIOLET": 12
};

// TRX Bet Types
const TRX_BET_TYPES = {
    "BIG": 13,
    "SMALL": 14
};

// Database setup
const DB_NAME = "auto_bot.db";

// Global storage
const userSessions = {};
const issueCheckers = {};
const autoBettingTasks = {};
const waitingForResults = {};
const processedIssues = {};

// Myanmar time function (without moment-timezone)
const getMyanmarTime = () => {
    const now = new Date();
    // Myanmar is UTC+6:30
    const myanmarOffset = 6.5 * 60 * 60 * 1000; // 6.5 hours in milliseconds
    const myanmarTime = new Date(now.getTime() + myanmarOffset);
    
    const year = myanmarTime.getUTCFullYear();
    const month = String(myanmarTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(myanmarTime.getUTCDate()).padStart(2, '0');
    const hours = String(myanmarTime.getUTCHours()).padStart(2, '0');
    const minutes = String(myanmarTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(myanmarTime.getUTCSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

class Database {
    constructor() {
        this.db = new sqlite3.Database(DB_NAME);
        this.initDatabase();
    }

    initDatabase() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                phone TEXT,
                password TEXT,
                platform TEXT DEFAULT '777',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                bet_amount INTEGER DEFAULT 100,
                auto_login BOOLEAN DEFAULT 1,
                bet_sequence TEXT DEFAULT '100,300,700,1600,3200,7600,16000,32000',
                current_bet_index INTEGER DEFAULT 0,
                platform TEXT DEFAULT '777',
                auto_betting BOOLEAN DEFAULT 0,
                random_betting TEXT DEFAULT 'bot',
                profit_target INTEGER DEFAULT 0,
                loss_target INTEGER DEFAULT 0,
                game_type TEXT DEFAULT 'WINGO',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS allowed_game_ids (
                game_id TEXT PRIMARY KEY,
                added_by INTEGER,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS bet_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                platform TEXT,
                issue TEXT,
                bet_type TEXT,
                amount INTEGER,
                result TEXT,
                profit_loss INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS pending_bets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                platform TEXT,
                issue TEXT,
                bet_type TEXT,
                amount INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS bot_sessions (
                user_id INTEGER PRIMARY KEY,
                is_running BOOLEAN DEFAULT 0,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_bets INTEGER DEFAULT 0,
                total_profit INTEGER DEFAULT 0,
                session_profit INTEGER DEFAULT 0,
                session_loss INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS formula_patterns (
                user_id INTEGER PRIMARY KEY,
                bs_pattern TEXT DEFAULT '',
                colour_pattern TEXT DEFAULT '',
                bs_current_index INTEGER DEFAULT 0,
                colour_current_index INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS sl_patterns (
                user_id INTEGER PRIMARY KEY,
                pattern TEXT DEFAULT '1,2,3,4,5',
                current_sl INTEGER DEFAULT 1,
                current_index INTEGER DEFAULT 0,
                wait_loss_count INTEGER DEFAULT 0,
                bet_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS sl_bet_sessions (
                user_id INTEGER PRIMARY KEY,
                is_wait_mode BOOLEAN DEFAULT 0,
                wait_bet_type TEXT DEFAULT '',
                wait_issue TEXT DEFAULT '',
                wait_amount INTEGER DEFAULT 0,
                wait_total_profit INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        tables.forEach(table => {
            this.db.run(table, (err) => {
                if (err) {
                    console.error('Error creating table:', err);
                }
            });
        });
    }

    // ... database methods remain the same ...
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
}

class LotteryAPI {
    constructor(platform = '777', gameType = 'WINGO') {
        this.platform = platform;
        this.gameType = gameType;
        this.baseUrl = API_ENDPOINTS[platform];
        this.token = '';
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": "https://www.bigwinqaz.com",
            "Referer": "https://www.bigwinqaz.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        };
    }

    signMd5(data) {
        const signData = { ...data };
        delete signData.signature;
        delete signData.timestamp;

        const sortedKeys = Object.keys(signData).sort();
        const sortedData = {};
        sortedKeys.forEach(key => {
            sortedData[key] = signData[key];
        });

        const hashString = JSON.stringify(sortedData).replace(/\s/g, '');
        return crypto.createHash('md5').update(hashString).digest('hex').toUpperCase();
    }

    randomKey() {
        const xxxx = "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx";
        let result = "";
        
        for (let char of xxxx) {
            if (char === 'x') {
                result += '0123456789abcdef'[Math.floor(Math.random() * 16)];
            } else if (char === 'y') {
                result += '89a'[Math.floor(Math.random() * 3)];
            } else {
                result += char;
            }
        }
        return result;
    }

    async login(phone, password) {
        try {
            const body = {
                "phonetype": -1,
                "language": 0,
                "logintype": "mobile",
                "random": "9078efc98754430e92e51da59eb2563c",
                "username": `95${phone}`,
                "pwd": password,
                "timestamp": Math.floor(Date.now() / 1000)
            };

            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}Login`, body, {
                headers: this.headers,
                timeout: 30000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0) {
                    const tokenData = result.data || {};
                    this.token = `${tokenData.tokenHeader || ''}${tokenData.token || ''}`;
                    this.headers.Authorization = this.token;
                    return { success: true, message: "Login successful", token: this.token };
                } else {
                    return { success: false, message: result.msg || "Login failed", token: "" };
                }
            } else {
                return { success: false, message: `API connection failed: ${response.status}`, token: "" };
            }
        } catch (error) {
            return { success: false, message: `Login error: ${error.message}`, token: "" };
        }
    }

    async getCurrentIssue() {
        try {
            const body = {
                "typeId": this.gameType === 'TRX' ? 13 : 1,
                "language": 0,
                "random": "b05034ba4a2642009350ee863f29e2e9",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const endpoint = this.gameType === 'TRX' ? 'GetTrxGameIssue' : 'GetGameIssue';
            const response = await axios.post(`${this.baseUrl}${endpoint}`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0) {
                    if (this.gameType === 'TRX') {
                        return result.data?.predraw?.issueNumber || '';
                    } else {
                        return result.data?.issueNumber || '';
                    }
                }
            }
            return "";
        } catch (error) {
            return "";
        }
    }

    async getBalance() {
        try {
            const body = {
                "language": 0,
                "random": "9078efc98754430e92e51da59eb2563c",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}GetBalance`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0) {
                    return result.data?.amount || 0;
                }
            }
            return 0;
        } catch (error) {
            return 0;
        }
    }

    async getUserInfo() {
        try {
            const body = {
                "language": 0,
                "random": "9078efc98754430e92e51da59eb2563c",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}GetUserInfo`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0) {
                    return result.data || {};
                }
            }
            return {};
        } catch (error) {
            return {};
        }
    }

    async placeBet(amount, betType) {
        try {
            const issueId = await this.getCurrentIssue();
            if (!issueId) {
                return { success: false, message: "Failed to get current issue", issueId: "", potentialProfit: 0 };
            }

            let requestBody;
            
            if (this.platform === '6lottery') {
                requestBody = {
                    "typeId": 1,
                    "issuenumber": issueId,
                    "language": 0,
                    "gameType": 0,
                    "amount": amount,
                    "betCount": 1,
                    "selectType": betType,
                    "random": this.randomKey(),
                    "timestamp": Math.floor(Date.now() / 1000)
                };
            } else {
                const baseAmount = amount < 10000 ? 10 : Math.pow(10, amount.toString().length - 2);
                const betCount = Math.floor(amount / baseAmount);
                const isColourBet = [10, 11, 12].includes(betType);
                
                requestBody = {
                    "typeId": this.gameType === 'TRX' ? 13 : 1,
                    "issuenumber": issueId,
                    "language": 0,
                    "gameType": isColourBet ? 0 : (this.gameType === 'TRX' ? 2 : 2),
                    "amount": baseAmount,
                    "betCount": betCount,
                    "selectType": betType,
                    "random": this.randomKey(),
                    "timestamp": Math.floor(Date.now() / 1000)
                };
            }

            requestBody.signature = this.signMd5(requestBody);

            console.log(`Betting details - Platform: ${this.platform}, Game: ${this.gameType}, Amount: ${amount}, Type: ${betType}`);
            console.log('Request Body:', JSON.stringify(requestBody));

            const endpoint = this.gameType === 'TRX' ? 'GameTrxBetting' : 'GameBetting';
            const response = await axios.post(`${this.baseUrl}${endpoint}`, requestBody, {
                headers: this.headers,
                timeout: 10000
            });

            console.log('API Response:', JSON.stringify(response.data));

            if (response.status === 200) {
                const result = response.data;
                if (result.code === 0 || result.msgCode === 0) {
                    let potentialProfit;
                    if (betType === 10) { // RED
                        potentialProfit = Math.floor(amount * 0.96);
                    } else if (betType === 11) { // GREEN
                        potentialProfit = Math.floor(amount * 0.96);
                    } else if (betType === 12) { // VIOLET
                        potentialProfit = Math.floor(amount * 0.44);
                    } else {
                        potentialProfit = Math.floor(amount * 0.96);
                    }
                    
                    return { success: true, message: "Bet placed successfully", issueId, potentialProfit, actualAmount: amount };
                } else {
                    const errorMsg = result.msg || 'Bet failed';
                    console.log('API Error:', errorMsg, 'Full response:', result);
                    return { success: false, message: errorMsg, issueId, potentialProfit: 0 };
                }
            }
            return { success: false, message: `API connection failed: ${response.status}`, issueId, potentialProfit: 0 };
        } catch (error) {
            console.log('Betting Error:', error.message);
            return { success: false, message: `Bet error: ${error.message}`, issueId: "", potentialProfit: 0 };
        }
    }

    async getRecentResults(count = 10) {
        try {
            if (this.gameType === 'TRX') {
                // TRX game results
                const body = {
                    "typeId": 13,
                    "language": 0,
                    "random": "b05034ba4a2642009350ee863f29e2e9",
                    "timestamp": Math.floor(Date.now() / 1000)
                };
                body.signature = this.signMd5(body);

                const response = await axios.post(`${this.baseUrl}GetTrxGameIssue`, body, {
                    headers: this.headers,
                    timeout: 10000
                });

                if (response.status === 200) {
                    const result = response.data;
                    if (result.msgCode === 0) {
                        const settled = result.data?.settled;
                        if (settled) {
                            const number = String(settled.number || '');
                            let colour = 'UNKNOWN';
                            if (['0', '5'].includes(number)) {
                                colour = 'VIOLET';
                            } else if (['1', '3', '7', '9'].includes(number)) {
                                colour = 'GREEN';
                            } else if (['2', '4', '6', '8'].includes(number)) {
                                colour = 'RED';
                            }
                            
                            return [{
                                issueNumber: settled.issueNumber,
                                number: number,
                                colour: colour
                            }];
                        }
                    }
                }
            } else {
                // WINGO game results
                const body = {
                    "pageNo": 1,
                    "pageSize": count,
                    "language": 0,
                    "typeId": 1,
                    "random": "6DEB0766860C42151A193692ED16D65A",
                    "timestamp": Math.floor(Date.now() / 1000)
                };
                body.signature = this.signMd5(body);

                const response = await axios.post(`${this.baseUrl}GetNoaverageEmerdList`, body, {
                    headers: this.headers,
                    timeout: 10000
                });

                if (response.status === 200) {
                    const result = response.data;
                    if (result.msgCode === 0) {
                        const dataStr = JSON.stringify(response.data);
                        const startIdx = dataStr.indexOf('[');
                        const endIdx = dataStr.indexOf(']') + 1;
                        
                        if (startIdx !== -1 && endIdx !== -1) {
                            const resultsJson = dataStr.substring(startIdx, endIdx);
                            const results = JSON.parse(resultsJson);
                            
                            results.forEach(resultItem => {
                                const number = String(resultItem.number || '');
                                if (['0', '5'].includes(number)) {
                                    resultItem.colour = 'VIOLET';
                                } else if (['1', '3', '7', '9'].includes(number)) {
                                    resultItem.colour = 'GREEN';
                                } else if (['2', '4', '6', '8'].includes(number)) {
                                    resultItem.colour = 'RED';
                                } else {
                                    resultItem.colour = 'UNKNOWN';
                                }
                            });
                            
                            return results;
                        }
                    }
                }
            }
            return [];
        } catch (error) {
            return [];
        }
    }
}

class AutoLotteryBot {
    constructor() {
        this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
        this.db = new Database();
        this.setupHandlers();
        console.log("Auto Lottery Bot initialized successfully!");
    }

    setupHandlers() {
        // Start command
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));

        // Admin commands
        this.bot.onText(/\/aid (.+)/, (msg, match) => this.handleAddGameId(msg, match));
        this.bot.onText(/\/rid (.+)/, (msg, match) => this.handleRemoveGameId(msg, match));
        this.bot.onText(/\/ids/, (msg) => this.handleListGameIds(msg));
        this.bot.onText(/\/gats/, (msg) => this.handleGameIdStats(msg));
        this.bot.onText(/\/broadcast (.+)/, (msg, match) => this.handleBroadcastMessage(msg, match));
        this.bot.onText(/\/msg (.+)/, (msg, match) => this.handleBroadcastActive(msg, match));

        // Callback queries
        this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));

        // Message handler
        this.bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                this.handleMessage(msg);
            }
        });

        // Error handler
        this.bot.on('polling_error', (error) => {
            console.error('Polling error:', error);
        });
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);
        
        console.log(`User ${userId} started the bot`);

        // Initialize user session
        userSessions[userId] = {
            step: 'main',
            phone: '',
            password: '',
            platform: '777',
            gameType: 'WINGO',
            loggedIn: false,
            apiInstance: null
        };

        const welcomeText = `Auto Lottery Bot

Welcome ${msg.from.first_name}!

Auto Bot Features:
- Random BIG Betting
- Random SMALL Betting  
- Random BIG/SMALL Betting
- Follow Bot (Follow Last Result)
- BS Formula Pattern Betting (B,S only)
- Colour Formula Pattern Betting (G,R,V only)
- SL Layer Pattern Betting
- Bot Statistics Tracking
- Auto Result Checking
- Profit/Loss Targets
- Colour Betting (RED, GREEN, VIOLET)
- TRX Game Support

Platform Support:
- 777 Big Win (WINGO & TRX)

Manual Features:
- Real-time Balance
- Game Results & History
- WINGO/TRX Game Switching

Press Run Bot to start auto betting!`;

        await this.bot.sendMessage(chatId, welcomeText, {
            reply_markup: this.getMainKeyboard()
        });
    }

    getMainKeyboard() {
        return {
            keyboard: [
                [{ text: "Login" }],
                [{ text: "Balance" }, { text: "Results" }],
                [{ text: "Bet BIG" }, { text: "Bet SMALL" }],
                [{ text: "Bet RED" }, { text: "Bet GREEN" }, { text: "Bet VIOLET" }],
                [{ text: "Bot Settings" }, { text: "My Bets" }],
                [{ text: "SL Layer" }, { text: "Bot Info" }],
                [{ text: "WINGO/TRX" }, { text: "Run Bot" }, { text: "Stop Bot" }]
            ],
            resize_keyboard: true
        };
    }

    getBotSettingsKeyboard() {
        return {
            keyboard: [
                [{ text: "Random BIG" }, { text: "Random SMALL" }],
                [{ text: "Random Bot" }, { text: "Follow Bot" }],
                [{ text: "BS Formula" }, { text: "Colour Formula" }],
                [{ text: "Bot Stats" }, { text: "Set Bet Sequence" }],
                [{ text: "Profit Target" }, { text: "Loss Target" }],
                [{ text: "WINGO/TRX" }, { text: "Reset Stats" }],
                [{ text: "Main Menu" }]
            ],
            resize_keyboard: true
        };
    }

    getGameTypeKeyboard() {
        return {
            keyboard: [
                [{ text: "WINGO" }, { text: "TRX" }],
                [{ text: "Back" }]
            ],
            resize_keyboard: true
        };
    }

    // ... other keyboard methods remain the same ...

    async handleMessage(msg) {
        if (!msg.text) return;

        const chatId = msg.chat.id;
        const userId = String(chatId);
        const text = msg.text;

        console.log(`User ${userId} sent: ${text}`);

        if (!userSessions[userId]) {
            userSessions[userId] = {
                step: 'main',
                phone: '',
                password: '',
                platform: '777',
                gameType: 'WINGO',
                loggedIn: false,
                apiInstance: null
            };
        }

        const userSession = userSessions[userId];

        // Handle different steps
        switch (userSession.step) {
            case 'login_phone':
                userSession.phone = text;
                userSession.step = 'login';
                await this.bot.sendMessage(chatId, `Phone number saved: ${text}\nNow please enter your password:`, {
                    reply_markup: this.getLoginKeyboard()
                });
                break;

            case 'login_password':
                userSession.password = text;
                userSession.step = 'login';
                await this.bot.sendMessage(chatId, "Password saved!\nClick 'Login Now' to authenticate.", {
                    reply_markup: this.getLoginKeyboard()
                });
                break;

            case 'set_game_type':
                await this.handleSetGameType(chatId, userId, text);
                break;

            // ... other cases remain the same ...
            case 'set_bet_sequence':
                await this.handleSetBetSequence(chatId, userId, text);
                break;

            case 'set_profit_target':
                await this.handleSetProfitTarget(chatId, userId, text);
                break;

            case 'set_loss_target':
                await this.handleSetLossTarget(chatId, userId, text);
                break;

            case 'set_bs_pattern':
                await this.handleSetBsPattern(chatId, userId, text);
                break;

            case 'set_colour_pattern':
                await this.handleSetColourPattern(chatId, userId, text);
                break;

            case 'set_sl_pattern':
                await this.handleSetSlPattern(chatId, userId, text);
                break;

            default:
                // Handle button commands
                await this.handleButtonCommand(chatId, userId, text);
        }
    }

    async handleButtonCommand(chatId, userId, text) {
        console.log(`Handling button command: '${text}' for user ${userId}`);

        const userSession = userSessions[userId];

        // Main Menu buttons
        switch (text) {
            case "Login":
                await this.handleBigwinLogin(chatId, userId);
                break;

            case "Balance":
                await this.handleBalance(chatId, userId);
                break;

            case "Results":
                await this.handleResults(chatId, userId);
                break;

            case "Bet BIG":
                await this.placeBetHandler(chatId, userId, 13);
                break;

            case "Bet SMALL":
                await this.placeBetHandler(chatId, userId, 14);
                break;

            case "Bet RED":
                await this.placeColourBet(chatId, userId, "RED");
                break;

            case "Bet GREEN":
                await this.placeColourBet(chatId, userId, "GREEN");
                break;

            case "Bet VIOLET":
                await this.placeColourBet(chatId, userId, "VIOLET");
                break;

            case "Bot Settings":
                await this.showBotSettings(chatId, userId);
                break;

            case "My Bets":
                await this.showMyBets(chatId, userId);
                break;

            case "SL Layer":
                await this.showSlLayer(chatId, userId);
                break;

            case "WINGO/TRX":
                await this.showGameTypeMenu(chatId, userId);
                break;

            case "Run Bot":
                await this.runBot(chatId, userId);
                break;

            case "Stop Bot":
                await this.stopBot(chatId, userId);
                break;

            case "Bot Info":
                await this.showBotInfo(chatId, userId);
                break;

            // ... other button cases remain the same ...

            case "WINGO":
            case "TRX":
                await this.handleSetGameType(chatId, userId, text);
                break;
        }
    }

    async showGameTypeMenu(chatId, userId) {
        const userSession = userSessions[userId];
        const currentGameType = userSession.gameType || 'WINGO';
        
        const gameTypeText = `Current Game Type: ${currentGameType}

Select Game Type:
- WINGO: Standard number game
- TRX: TRX cryptocurrency game

Choose your game type:`;

        await this.bot.sendMessage(chatId, gameTypeText, {
            reply_markup: this.getGameTypeKeyboard()
        });
    }

    async handleSetGameType(chatId, userId, text) {
        const userSession = userSessions[userId];
        const gameType = text.toUpperCase();
        
        if (gameType === 'WINGO' || gameType === 'TRX') {
            userSession.gameType = gameType;
            await this.saveUserSetting(userId, 'game_type', gameType);
            
            // Update API instance with new game type
            if (userSession.apiInstance) {
                userSession.apiInstance.gameType = gameType;
            }
            
            userSession.step = 'main';
            await this.bot.sendMessage(chatId, `Game type set to: ${gameType}`, {
                reply_markup: this.getMainKeyboard()
            });
        } else {
            await this.bot.sendMessage(chatId, "Invalid game type. Please select WINGO or TRX.", {
                reply_markup: this.getGameTypeKeyboard()
            });
        }
    }

    async handleBalance(chatId, userId) {
        const userSession = userSessions[userId];
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        try {
            const balance = await userSession.apiInstance.getBalance();
            const userInfo = await userSession.apiInstance.getUserInfo();
            const user_id_display = userInfo.userId || 'N/A';
            const gameType = userSession.gameType || 'WINGO';

            const platformName = '777 Big Win';

            const balanceText = `Account Information

Platform: ${platformName}
Game Type: ${gameType}
User ID: ${user_id_display}
Balance: ${balance.toLocaleString()} K
Status: LOGGED IN

Last update: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, balanceText);
        } catch (error) {
            await this.bot.sendMessage(chatId, `Error getting balance: ${error.message}`);
        }
    }

    async handleResults(chatId, userId) {
        const userSession = userSessions[userId];
        const platformName = '777 Big Win';
        const gameType = userSession.gameType || 'WINGO';

        try {
            let results;
            if (userSession.apiInstance) {
                results = await userSession.apiInstance.getRecentResults(10);
            } else {
                const api = new LotteryAPI(userSession.platform || '777', gameType);
                results = await api.getRecentResults(10);
            }

            if (!results || results.length === 0) {
                await this.bot.sendMessage(chatId, "No recent results available.");
                return;
            }

            let resultsText = `Recent Game Results - ${platformName} (${gameType})\n\n`;
            results.forEach((result, i) => {
                const issueNo = result.issueNumber || 'N/A';
                const number = result.number || 'N/A';
                const resultType = ['0','1','2','3','4'].includes(number) ? "SMALL" : "BIG";
                const colour = result.colour || 'UNKNOWN';

                resultsText += `${i+1}. ${issueNo} - ${number} - ${resultType} ${colour}\n`;
            });

            resultsText += `\nLast updated: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, resultsText);
        } catch (error) {
            await this.bot.sendMessage(chatId, `Error getting results: ${error.message}`);
        }
    }

    async placeBetHandler(chatId, userId, betType) {
        const userSession = userSessions[userId];
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        try {
            const currentIssue = await userSession.apiInstance.getCurrentIssue();
            if (!currentIssue) {
                await this.bot.sendMessage(chatId, "Cannot get current game issue. Please try again.");
                return;
            }

            if (await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue)) {
                await this.bot.sendMessage(chatId, `Wait for next period\n\nYou have already placed a bet on issue ${currentIssue}.\nPlease wait for the next game period to place another bet.`);
                return;
            }

            const amount = await this.getCurrentBetAmount(userId);
            const betTypeStr = betType === 13 ? "BIG" : "SMALL";
            const gameType = userSession.gameType || 'WINGO';

            const balance = await userSession.apiInstance.getBalance();
            if (balance < amount) {
                await this.bot.sendMessage(chatId, `Insufficient balance! You have ${balance.toLocaleString()} K but need ${amount.toLocaleString()} K`);
                return;
            }

            const platformName = '777 Big Win';

            const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${betTypeStr} bet...\nPlatform: ${platformName}\nGame: ${gameType}\nIssue: ${currentIssue}\nAmount: ${amount.toLocaleString()} K`);

            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const betText = `Bet Placed Successfully!

Platform: ${platformName}
Game: ${gameType}
Issue: ${result.issueId}
Type: ${betTypeStr}
Amount: ${amount.toLocaleString()} K`;

                await this.bot.editMessageText(betText, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                await this.bot.editMessageText(`Bet failed: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, `Bet error: ${error.message}`);
        }
    }

    // ... other methods remain similar but updated to handle game type ...

    async showBotInfo(chatId, userId) {
        const userSession = userSessions[userId];
        
        try {
            let userInfo = {};
            let balance = 0;
            if (userSession.loggedIn && userSession.apiInstance) {
                balance = await userSession.apiInstance.getBalance();
                userInfo = await userSession.apiInstance.getUserInfo();
            }

            const user_id_display = userInfo.userId || 'N/A';
            const phone = userSession.phone || 'Not logged in';
            const gameType = userSession.gameType || 'WINGO';
            
            const platformName = '777 Big Win';
            
            const botSession = await this.getBotSession(userId);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const currentAmount = await this.getCurrentBetAmount(userId);
            
            // ... rest of bot info method remains similar but includes gameType ...
            
            const botInfoText = `BOT INFORMATION

User Info:
- User ID: ${user_id_display}
- Phone: ${phone}
- Platform: ${platformName}
- Game Type: ${gameType}
- Balance: ${balance.toLocaleString()} K

// ... rest of the bot info text ...
`;

            await this.bot.sendMessage(chatId, botInfoText);
            
        } catch (error) {
            console.error("Error in showBotInfo:", error);
            await this.bot.sendMessage(chatId, "Error loading bot information. Please try again.");
        }
    }

    // Update the API instance creation to include game type
    async processLogin(chatId, userId) {
        const userSession = userSessions[userId];
        
        if (!userSession.phone || !userSession.password) {
            await this.bot.sendMessage(chatId, "Please enter phone number and password first!", {
                reply_markup: this.getLoginKeyboard()
            });
            return;
        }

        const loadingMsg = await this.bot.sendMessage(chatId, "Logging in... Please wait.");

        try {
            // Create API instance with game type
            userSession.apiInstance = new LotteryAPI(userSession.platform, userSession.gameType);
            const result = await userSession.apiInstance.login(userSession.phone, userSession.password);
            
            if (result.success) {
                const userInfo = await userSession.apiInstance.getUserInfo();
                const gameId = userInfo.userId || '';
                
                // Check if game ID is allowed
                if (!await this.isGameIdAllowed(gameId)) {
                    await this.bot.editMessageText(`Login Failed!\n\nGame ID: ${gameId}\nStatus: NOT ALLOWED\n\nPlease contact admin: @Smile_p2`, {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id
                    });
                    return;
                }

                userSession.loggedIn = true;
                userSession.step = 'main';

                const balance = await userSession.apiInstance.getBalance();
                const gameType = userSession.gameType || 'WINGO';

                await this.saveUserCredentials(userId, userSession.phone, userSession.password, userSession.platform);
                await this.saveUserSetting(userId, 'auto_login', 1);
                await this.saveUserSetting(userId, 'game_type', gameType);

                const platformName = '777 Big Win';
                
                const successText = `Login Successful!

Platform: ${platformName}
Game Type: ${gameType}
Game ID: ${gameId}
Account: ${userSession.phone}
Balance: ${balance.toLocaleString()} K

Status: VERIFIED`;

                await this.bot.editMessageText(successText, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });

                await this.bot.sendMessage(chatId, "Choose an option:", {
                    reply_markup: this.getMainKeyboard()
                });
            } else {
                await this.bot.editMessageText(`Login failed: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            await this.bot.editMessageText(`Login error: ${error.message}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
    }

    // ... other methods remain similar with game type integration ...
}

// Start the bot
console.log("Auto Lottery Bot starting...");
console.log("Game ID Restriction System: ENABLED");
console.log("Admin Commands: /aid, /rid, /ids, /gats");
console.log("Admin Broadcast: /broadcast, /msg");
console.log(`Admin User ID: ${ADMIN_USER_ID}`);
console.log("Features: Wait for Win/Loss before next bet");
console.log("Modes: BIG Only, SMALL Only, Random Bot, Follow Bot");
console.log("BS Formula Pattern Betting System (B,S only)");
console.log("Colour Formula Pattern Betting System (G,R,V only)");
console.log("SL Layer Pattern Betting System - BS/COLOUR PATTERN MODE REQUIRED");
console.log("Bet Sequence System: 100,300,700,1600,3200,7600,16000,32000");
console.log("Profit/Loss Target System");
console.log("Auto Statistics Tracking");
console.log("Colour Betting Support (RED, GREEN, VIOLET)");
console.log("TRX Game Support: ENABLED");
console.log("Supported Platforms: 777 Big Win (WINGO & TRX)");
console.log("Myanmar Time System: ENABLED");
console.log("Press Ctrl+C to stop.");

const bot = new AutoLotteryBot();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    process.exit();
});
