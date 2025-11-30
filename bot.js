const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const crypto = require('crypto');

// Bot configuration
const BOT_TOKEN = "7968178268:AAF4fNYlwzTtAjw967Vsk1vFD2VRPXbF95Q";
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

// Myanmar time function
const getMyanmarTime = () => {
    const now = new Date();
    const myanmarOffset = 6.5 * 60 * 60 * 1000;
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
            console.error('Error getting user info:', error.message);
            return {};
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
            console.error('Error getting balance:', error.message);
            return 0;
        }
    }

    async getCurrentIssue() {
        try {
            let typeId;
            let endpoint;
            
            if (this.gameType === 'TRX') {
                typeId = 13;
                endpoint = 'GetTrxGameIssue';
            } else if (this.gameType === 'WINGO_3MIN') {
                typeId = 2;
                endpoint = 'GetGameIssue';
            } else {
                typeId = 1;
                endpoint = 'GetGameIssue';
            }

            const body = {
                "typeId": typeId,
                "language": 0,
                "random": "b05034ba4a2642009350ee863f29e2e9",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

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
                        return result.data?.issueNumber || result.data?.predraw?.issueNumber || '';
                    }
                }
            }
            return "";
        } catch (error) {
            console.error('Error getting current issue:', error.message);
            return "";
        }
    }

    async placeBet(amount, betType) {
        try {
            const issueId = await this.getCurrentIssue();
            if (!issueId) {
                return { success: false, message: "Failed to get current issue", issueId: "", potentialProfit: 0 };
            }

            console.log(`🎰 Placing bet - Issue: ${issueId}, Amount: ${amount}, BetType: ${betType}, GameType: ${this.gameType}`);

            let validAmount = amount;
            
            if (typeof validAmount !== 'number') {
                validAmount = parseInt(validAmount);
            }
            
            if (this.gameType === 'WINGO_3MIN') {
                const allowedAmounts = [100, 500, 1000, 5000];
                if (!allowedAmounts.includes(validAmount)) {
                    const closestAmount = allowedAmounts.reduce((prev, curr) => {
                        return (Math.abs(curr - validAmount) < Math.abs(prev - validAmount) ? curr : prev);
                    });
                    console.log(`🔄 Adjusting amount from ${validAmount} to ${closestAmount} for WINGO_3MIN`);
                    validAmount = closestAmount;
                }
            } else if (this.gameType === 'TRX') {
                const allowedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                if (!allowedAmounts.includes(validAmount)) {
                    const closestAmount = allowedAmounts.reduce((prev, curr) => {
                        return (Math.abs(curr - validAmount) < Math.abs(prev - validAmount) ? curr : prev);
                    });
                    console.log(`🔄 Adjusting amount from ${validAmount} to ${closestAmount} for TRX`);
                    validAmount = closestAmount;
                }
            } else {
                const allowedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                if (!allowedAmounts.includes(validAmount)) {
                    const closestAmount = allowedAmounts.reduce((prev, curr) => {
                        return (Math.abs(curr - validAmount) < Math.abs(prev - validAmount) ? curr : prev);
                    });
                    console.log(`🔄 Adjusting amount from ${validAmount} to ${closestAmount} for WINGO`);
                    validAmount = closestAmount;
                }
            }
            
            if (validAmount < 100) {
                validAmount = 100;
            }
            
            if (validAmount > 50000) {
                validAmount = 50000;
            }

            const currentTime = Math.floor(Date.now() / 1000);
            let requestBody;

            if (this.gameType === 'TRX') {
                if (betType === 10 || betType === 11 || betType === 12) {
                    return { 
                        success: false, 
                        message: "TRX game does not support colour betting. Please use BIG or SMALL only.", 
                        issueId: "", 
                        potentialProfit: 0 
                    };
                }
                
                requestBody = {
                    "typeId": 13,
                    "issuenumber": issueId,
                    "language": 0,
                    "gameType": 2,
                    "amount": validAmount,
                    "betCount": 1,
                    "selectType": betType,
                    "random": this.randomKey(),
                    "timestamp": currentTime
                };
            } else if (this.gameType === 'WINGO_3MIN') {
                const isColourBet = [10, 11, 12].includes(betType);
                
                if (isColourBet) {
                    requestBody = {
                        "typeId": 2,
                        "issuenumber": issueId,
                        "language": 0,
                        "gameType": 0,
                        "amount": validAmount,
                        "betCount": 1,
                        "selectType": betType,
                        "random": this.randomKey(),
                        "timestamp": currentTime
                    };
                } else {
                    requestBody = {
                        "typeId": 2,
                        "issuenumber": issueId,
                        "language": 0,
                        "gameType": 2,
                        "amount": validAmount,
                        "betCount": 1,
                        "selectType": betType,
                        "random": this.randomKey(),
                        "timestamp": currentTime
                    };
                }
            } else {
                const isColourBet = [10, 11, 12].includes(betType);
                
                if (isColourBet) {
                    requestBody = {
                        "typeId": 1,
                        "issuenumber": issueId,
                        "language": 0,
                        "gameType": 0,
                        "amount": validAmount,
                        "betCount": 1,
                        "selectType": betType,
                        "random": this.randomKey(),
                        "timestamp": currentTime
                    };
                } else {
                    requestBody = {
                        "typeId": 1,
                        "issuenumber": issueId,
                        "language": 0,
                        "gameType": 2,
                        "amount": validAmount,
                        "betCount": 1,
                        "selectType": betType,
                        "random": this.randomKey(),
                        "timestamp": currentTime
                    };
                }
            }

            requestBody.signature = this.signMd5(requestBody);

            console.log('📤 Request Body:', JSON.stringify(requestBody, null, 2));

            let endpoint;
            if (this.gameType === 'TRX') {
                endpoint = 'GameTrxBetting';
            } else {
                endpoint = 'GameBetting';
            }

            const response = await axios.post(`${this.baseUrl}${endpoint}`, requestBody, {
                headers: this.headers,
                timeout: 15000
            });

            console.log('📥 API Response:', JSON.stringify(response.data, null, 2));

            if (response.status === 200) {
                const result = response.data;
                if (result.code === 0 || result.msgCode === 0) {
                    let potentialProfit;
                    if (betType === 10 || betType === 11) {
                        potentialProfit = Math.floor(validAmount * 0.96);
                    } else if (betType === 12) {
                        potentialProfit = Math.floor(validAmount * 0.44);
                    } else {
                        potentialProfit = Math.floor(validAmount * 0.96);
                    }
                    
                    return { 
                        success: true, 
                        message: "Bet placed successfully", 
                        issueId, 
                        potentialProfit, 
                        actualAmount: validAmount 
                    };
                } else {
                    const errorMsg = result.msg || result.message || 'Bet failed';
                    console.log('❌ Bet API Error:', errorMsg);
                    
                    if (errorMsg.includes('amount') || errorMsg.includes('betting') || errorMsg.includes('error')) {
                        return { 
                            success: false, 
                            message: `Bet amount error: ${validAmount}K is not allowed. Trying different amount...`, 
                            issueId, 
                            potentialProfit: 0 
                        };
                    }
                    
                    return { 
                        success: false, 
                        message: errorMsg, 
                        issueId, 
                        potentialProfit: 0 
                    };
                }
            } else {
                console.log('❌ HTTP Error:', response.status, response.statusText);
                return { 
                    success: false, 
                    message: `API connection failed: ${response.status}`, 
                    issueId, 
                    potentialProfit: 0 
                };
            }
        } catch (error) {
            console.log('💥 Betting Error:', error.message);
            if (error.response) {
                console.log('❌ Error Response Data:', error.response.data);
            }
            return { 
                success: false, 
                message: `Bet error: ${error.message}`, 
                issueId: "", 
                potentialProfit: 0 
            };
        }
    }

    async getRecentResults(count = 10) {
        try {
            if (this.gameType === 'TRX') {
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
                let typeId;
                if (this.gameType === 'WINGO_3MIN') {
                    typeId = 2;
                } else {
                    typeId = 1;
                }
                
                const body = {
                    "pageNo": 1,
                    "pageSize": count,
                    "language": 0,
                    "typeId": typeId,
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
            console.error('Error getting recent results:', error.message);
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
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
        this.bot.onText(/\/aid (.+)/, (msg, match) => this.handleAddGameId(msg, match));
        this.bot.onText(/\/rid (.+)/, (msg, match) => this.handleRemoveGameId(msg, match));
        this.bot.onText(/\/ids/, (msg) => this.handleListGameIds(msg));
        this.bot.onText(/\/gats/, (msg) => this.handleGameIdStats(msg));
        this.bot.onText(/\/broadcast (.+)/, (msg, match) => this.handleBroadcastMessage(msg, match));
        this.bot.onText(/\/msg (.+)/, (msg, match) => this.handleBroadcastActive(msg, match));

        this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));

        this.bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                this.handleMessage(msg);
            }
        });

        this.bot.on('polling_error', (error) => {
            console.error('Polling error:', error);
        });
    }

    ensureUserSession(userId) {
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
        return userSessions[userId];
    }

    getMainKeyboard(userId = null) {
        let userSession;
        if (userId) {
            userSession = this.ensureUserSession(userId);
        } else {
            userSession = { gameType: 'WINGO' };
        }
        
        if (userSession && userSession.gameType === 'TRX') {
            return {
                keyboard: [
                    [{ text: "Login" }],
                    [{ text: "Balance" }, { text: "Results" }],
                    [{ text: "Bet BIG" }, { text: "Bet SMALL" }],
                    [{ text: "Bot Settings" }, { text: "My Bets" }],
                    [{ text: "SL Layer" }, { text: "Bot Info" }],
                    [{ text: "WINGO/TRX" }], 
                    [{ text: "Run Bot" }, { text: "Stop Bot" }]
                ],
                resize_keyboard: true
            };
        } else {
            return {
                keyboard: [
                    [{ text: "Login" }],
                    [{ text: "Balance" }, { text: "Results" }],
                    [{ text: "Bet BIG" }, { text: "Bet SMALL" }],
                    [{ text: "Bet RED" }, { text: "Bet GREEN" }, { text: "Bet VIOLET" }],
                    [{ text: "Bot Settings" }, { text: "My Bets" }],
                    [{ text: "SL Layer" }, { text: "Bot Info" }],
                    [{ text: "WINGO/TRX" }], 
                    [{ text: "Run Bot" }, { text: "Stop Bot" }]
                ],
                resize_keyboard: true
            };
        }
    }

    getBotSettingsKeyboard() {
        return {
            keyboard: [
                [{ text: "Random BIG" }, { text: "Random SMALL" }],
                [{ text: "Random Bot" }, { text: "Follow Bot" }],
                [{ text: "BS Formula" }, { text: "Colour Formula" }],
                [{ text: "Bot Stats" }, { text: "Set Bet Sequence" }],
                [{ text: "Profit Target" }, { text: "Loss Target" }],
               [{text: "Reset Stats" },
                {text: "Main Menu" }]
            ],
            resize_keyboard: true
        };
    }

    getLoginKeyboard() {
        return {
            keyboard: [
                [{ text: "Enter Phone" }, { text: "Enter Password" }],
                [{ text: "Login Now" },  { text: "Back" }]
            ],
            resize_keyboard: true
        };
    }

    getGameTypeKeyboard() {
        return {
            keyboard: [
                [{ text: "WINGO" }, { text: "TRX" }],
                [{ text: "WINGO 3 MIN" }],
                [{ text: "Back" }]
            ],
            resize_keyboard: true
        };
    }

    getBsPatternKeyboard() {
        return {
            keyboard: [
                [{ text: "Set BS Pattern" }, { text: "View BS Pattern" }],
                [{ text: "Clear BS Pattern" }, { text: "Bot Settings" }]
            ],
            resize_keyboard: true
        };
    }

    getColourPatternKeyboard() {
        return {
            keyboard: [
                [{ text: "Set Colour Pattern" }, { text: "View Colour Pattern" }],
                [{ text: "Clear Colour Pattern" }, { text: "Bot Settings" }]
            ],
            resize_keyboard: true
        };
    }

    getSlLayerKeyboard() {
        return {
            keyboard: [
                [{ text: "Set SL Pattern" }, { text: "View SL Pattern" }],
                [{ text: "Reset SL Pattern" }, { text: "SL Stats" }],
                [{ text: "Main Menu" }]
            ],
            resize_keyboard: true
        };
    }
    
    async getColourFormulaBetType(userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const colourPattern = patternsData.colour_pattern;
            let currentIndex = patternsData.colour_current_index;
            
            if (!colourPattern) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { 
                    betType, 
                    betTypeStr: betType === 13 ? "BIG (Random Fallback)" : "SMALL (Random Fallback)" 
                };
            }

            const patternArray = colourPattern.split(',');
            
            if (currentIndex >= patternArray.length) {
                currentIndex = 0;
            }

            const currentBet = patternArray[currentIndex];
            
            let betType;
            let betTypeStr;
            
            switch(currentBet) {
                case 'G':
                    betType = 11;
                    betTypeStr = "GREEN";
                    break;
                case 'R':
                    betType = 10;
                    betTypeStr = "RED";
                    break;
                case 'V':
                    betType = 12;
                    betTypeStr = "VIOLET";
                    break;
                default:
                    betType = Math.random() < 0.5 ? 13 : 14;
                    betTypeStr = betType === 13 ? "BIG" : "SMALL";
            }

            const fullBetTypeStr = `${betTypeStr} (Colour Formula ${currentIndex + 1}/${patternArray.length})`;

            const newIndex = currentIndex + 1;
            await this.updateColourPatternIndex(userId, newIndex);

            return { betType, betTypeStr: fullBetTypeStr };
            
        } catch (error) {
            console.error(`Error getting Colour formula bet type for user ${userId}:`, error);
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async updateColourPatternIndex(userId, newIndex) {
        try {
            await this.db.run(
                'UPDATE formula_patterns SET colour_current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [newIndex, userId]
            );
            return true;
        } catch (error) {
            console.error(`Error updating Colour pattern index for user ${userId}:`, error);
            return false;
        }
    }

    async getBsFormulaBetType(userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern;
            let currentIndex = patternsData.bs_current_index;
            
            if (!bsPattern) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { 
                    betType, 
                    betTypeStr: betType === 13 ? "BIG (Random Fallback)" : "SMALL (Random Fallback)" 
                };
            }

            const patternArray = bsPattern.split(',');
            
            if (currentIndex >= patternArray.length) {
                currentIndex = 0;
            }

            const currentBet = patternArray[currentIndex];
            const betType = currentBet === 'B' ? 13 : 14;
            const betTypeStr = `${currentBet === 'B' ? 'BIG' : 'SMALL'} (BS Formula ${currentIndex + 1}/${patternArray.length})`;

            const newIndex = currentIndex + 1;
            await this.updateBsPatternIndex(userId, newIndex);

            return { betType, betTypeStr };
            
        } catch (error) {
            console.error(`Error getting BS formula bet type for user ${userId}:`, error);
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async updateBsPatternIndex(userId, newIndex) {
        try {
            await this.db.run(
                'UPDATE formula_patterns SET bs_current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [newIndex, userId]
            );
            return true;
        } catch (error) {
            console.error(`Error updating BS pattern index for user ${userId}:`, error);
            return false;
        }
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);
        
        console.log(`User ${userId} started the bot`);

        this.ensureUserSession(userId);

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

    async handleCallbackQuery(query) {
        const chatId = query.message.chat.id;
        const userId = String(chatId);

        console.log(`Callback query: ${query.data} from user ${userId}`);

        if (query.data === "check_join") {
            await this.bot.answerCallbackQuery(query.id);
            await this.bot.editMessageText("Thank you for joining our channel! You can now use the bot.\n\nPress /start to begin.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }
    }

    async handleMessage(msg) {
        if (!msg.text) return;

        const chatId = msg.chat.id;
        const userId = String(chatId);
        const text = msg.text;

        console.log(`User ${userId} sent: ${text}`);

        const userSession = this.ensureUserSession(userId);

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
                await this.handleButtonCommand(chatId, userId, text);
        }
    }

    async handleButtonCommand(chatId, userId, text) {
        console.log(`Handling button command: '${text}' for user ${userId}`);
        
        try {
            const userSession = this.ensureUserSession(userId);

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

                case "Enter Phone":
                    userSession.step = 'login_phone';
                    await this.bot.sendMessage(chatId, "Please enter your phone number (without country code):");
                    break;

                case "Enter Password":
                    userSession.step = 'login_password';
                    await this.bot.sendMessage(chatId, "Please enter your password:");
                    break;

                case "Login Now":
                    await this.processLogin(chatId, userId);
                    break;

                case "Back":
                    userSession.step = 'main';
                    await this.bot.sendMessage(chatId, "Main Menu", {
                        reply_markup: this.getMainKeyboard()
                    });
                    break;

                case "Random BIG":
                    await this.setRandomBig(chatId, userId);
                    break;

                case "Random SMALL":
                    await this.setRandomSmall(chatId, userId);
                    break;

                case "Random Bot":
                    await this.setRandomBot(chatId, userId);
                    break;

                case "Follow Bot":
                    await this.setFollowBot(chatId, userId);
                    break;

                case "BS Formula":
                    await this.showBsFormula(chatId, userId);
                    break;

                case "Colour Formula":
                    await this.showColourFormula(chatId, userId);
                    break;

                case "Bot Stats":
                    await this.showBotStats(chatId, userId);
                    break;

                case "Set Bet Sequence":
                    userSession.step = 'set_bet_sequence';
                    const currentSequence = await this.getUserSetting(userId, 'bet_sequence', '');
                    await this.bot.sendMessage(chatId, `Current bet sequence: ${currentSequence}\nEnter new bet sequence (comma separated e.g., 100,300,700,1600,3200,7600,16000,32000):`);
                    break;

                case "Profit Target":
                    userSession.step = 'set_profit_target';
                    const currentProfitTarget = await this.getUserSetting(userId, 'profit_target', 0);
                    await this.bot.sendMessage(chatId, `Set Profit Target\n\nCurrent target: ${currentProfitTarget.toLocaleString()} K\n\nPlease enter the profit target amount (in K):\nExample: 1000 (for 1000 K profit target)\nEnter 0 to disable profit target`);
                    break;

                case "Loss Target":
                    userSession.step = 'set_loss_target';
                    const currentLossTarget = await this.getUserSetting(userId, 'loss_target', 0);
                    await this.bot.sendMessage(chatId, `Set Loss Target\n\nCurrent target: ${currentLossTarget.toLocaleString()} K\n\nPlease enter the loss target amount (in K):\nExample: 500 (for 500 K loss target)\nEnter 0 to disable loss target`);
                    break;

                case "Reset Stats":
                    await this.resetBotStats(chatId, userId);
                    break;

                case "Main Menu":
                    userSession.step = 'main';
                    await this.bot.sendMessage(chatId, "Main Menu", {
                        reply_markup: this.getMainKeyboard()
                    });
                    break;

                case "Set BS Pattern":
                    userSession.step = 'set_bs_pattern';
                    await this.bot.sendMessage(chatId, "Set BS Pattern for BS Formula Mode\n\nEnter your BS pattern using ONLY B for BIG and S for SMALL:\n\nExamples:\n- B,S,B,B\n- S,S,B\n- B,B,B,S\n\nEnter your BS pattern:");
                    break;

                case "View BS Pattern":
                    await this.viewBsPattern(chatId, userId);
                    break;

                case "Clear BS Pattern":
                    await this.clearBsPattern(chatId, userId);
                    break;

                case "Set Colour Pattern":
                    userSession.step = 'set_colour_pattern';
                    await this.bot.sendMessage(chatId, "Set Colour Pattern for Colour Formula Mode\n\nEnter your Colour pattern using ONLY:\n- G for GREEN\n- R for RED\n- V for VIOLET\n\nExamples:\n- R,G,V,R\n- G,V,R\n- R,R,G\n\nEnter your Colour pattern:");
                    break;

                case "View Colour Pattern":
                    await this.viewColourPattern(chatId, userId);
                    break;

                case "Clear Colour Pattern":
                    await this.clearColourPattern(chatId, userId);
                    break;

                case "Set SL Pattern":
                    userSession.step = 'set_sl_pattern';
                    await this.bot.sendMessage(chatId, "Set SL Pattern\n\nEnter your SL pattern (comma separated numbers 1-5):\nExample: 2,1,3 (Starts from SL 2 with WAIT BOT)\nExample: 2,1 (Starts from SL 2 with WAIT BOT)\nExample: 1,2,3 (Starts from SL 1 with BETTING)\n\nEnter your SL pattern:");
                    break;

                case "View SL Pattern":
                    await this.viewSlPattern(chatId, userId);
                    break;

                case "Reset SL Pattern":
                    await this.resetSlPattern(chatId, userId);
                    break;

                case "SL Stats":
                    await this.showSlStats(chatId, userId);
                    break;

                case "WINGO 3 MIN":
                    await this.handleSetGameType(chatId, userId, text);
                    break;

                case "WINGO":
                case "TRX":
                    await this.handleSetGameType(chatId, userId, text);
                    break;

                default:
                    await this.bot.sendMessage(chatId, "Please use the buttons below to navigate.", {
                        reply_markup: this.getMainKeyboard()
                    });
            }
        } catch (error) {
            console.error(`Error handling button command '${text}' for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error processing command. Please try again.");
        }
    }

    async showGameTypeMenu(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        const currentGameType = userSession.gameType || 'WINGO';
        
        let gameTypeInfo = "";
        if (currentGameType === 'TRX') {
            gameTypeInfo = "\n\n⚠️ TRX Game: Supports BIG/SMALL only (No colour betting)";
        } else if (currentGameType === 'WINGO_3MIN') {
            gameTypeInfo = "\n\n✅ WINGO 3 MIN: Supports both BIG/SMALL and Colour betting";
        } else {
            gameTypeInfo = "\n\n✅ WINGO: Supports both BIG/SMALL and Colour betting";
        }
        
        const gameTypeText = `🎮 Current Game Type: ${currentGameType}${gameTypeInfo}

Select Game Type:
• WINGO: Standard number game (BIG/SMALL + Colours)
• TRX: TRX cryptocurrency game (BIG/SMALL only)  
• WINGO 3 MIN: WINGO 3 Minute game (BIG/SMALL + Colours)

Choose your game type:`;

        await this.bot.sendMessage(chatId, gameTypeText, {
            reply_markup: this.getGameTypeKeyboard()
        });
    }

    async handleSetGameType(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            let gameType = text.toUpperCase();
            
            if (text === "WINGO 3 MIN") {
                gameType = "WINGO_3MIN";
            }
            
            if (gameType === 'WINGO' || gameType === 'TRX' || gameType === 'WINGO_3MIN') {
                userSession.gameType = gameType;
                await this.saveUserSetting(userId, 'game_type', gameType);
                
                if (userSession.apiInstance) {
                    userSession.apiInstance.gameType = gameType;
                }
                
                userSession.step = 'main';
                
                let displayGameType = text;
                await this.bot.sendMessage(chatId, `Game type set to: ${displayGameType}`, {
                    reply_markup: this.getMainKeyboard()
                });
            } else {
                await this.bot.sendMessage(chatId, "Invalid game type. Please select WINGO, TRX or WINGO 3 MIN.", {
                    reply_markup: this.getGameTypeKeyboard()
                });
            }
        } catch (error) {
            console.error(`Error setting game type for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting game type. Please try again.");
        }
    }

    async handleBigwinLogin(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        userSession.step = 'login';
        userSession.platform = '777';
        userSession.apiInstance = new LotteryAPI('777', userSession.gameType);

        const loginGuide = `777 Big Win Login

Please follow these steps:

1. Click 'Enter Phone' and send your phone number
2. Click 'Enter Password' and send your password  
3. Click 'Login Now' to authenticate

Your credentials will be saved for future use!`;

        await this.bot.sendMessage(chatId, loginGuide, {
            reply_markup: this.getLoginKeyboard()
        });
    }

    async processLogin(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        
        if (!userSession.phone || !userSession.password) {
            await this.bot.sendMessage(chatId, "Please enter phone number and password first!", {
                reply_markup: this.getLoginKeyboard()
            });
            return;
        }

        const loadingMsg = await this.bot.sendMessage(chatId, "Logging in... Please wait.");

        try {
            const result = await userSession.apiInstance.login(userSession.phone, userSession.password);
            
            if (result.success) {
                const userInfo = await userSession.apiInstance.getUserInfo();
                const gameId = userInfo.userId || '';
                
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

    async handleBalance(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        
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
        const userSession = this.ensureUserSession(userId);
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
        const userSession = this.ensureUserSession(userId);
        
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

            const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${betTypeStr} Bet\n\nGame: ${gameType}\nIssue: ${currentIssue}\nAmount: ${amount.toLocaleString()} K`);

            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const betText = `Bet Placed Successfully!\n\nGame: ${gameType}\nIssue: ${result.issueId}\nType: ${betTypeStr}\nAmount: ${amount.toLocaleString()} K`;

                await this.bot.editMessageText(betText, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                await this.bot.editMessageText(`Bet Failed\n\nError: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, `Bet Error\n\nError: ${error.message}`);
        }
    }

    async placeColourBet(chatId, userId, colour) {
        const userSession = this.ensureUserSession(userId);
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "🔐 Please login first!");
            return;
        }

        try {
            if (userSession.gameType === 'TRX') {
                await this.bot.sendMessage(chatId, `❌ TRX Game Notice\n\nTRX game does not support colour betting.\n\nPlease use:\n• Bet BIG\n• Bet SMALL\n\nOr switch to WINGO/WINGO 3 MIN for colour betting.`);
                return;
            }

            const currentIssue = await userSession.apiInstance.getCurrentIssue();
            if (!currentIssue) {
                await this.bot.sendMessage(chatId, "❌ Cannot get current game issue. Please try again.");
                return;
            }

            if (await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue)) {
                await this.bot.sendMessage(chatId, `⏳ Wait for next period\n\nYou have already placed a bet on issue ${currentIssue}.\nPlease wait for the next game period to place another bet.`);
                return;
            }

            const amount = await this.getCurrentBetAmount(userId);
            const betType = COLOUR_BET_TYPES[colour];
            const gameType = userSession.gameType || 'WINGO';

            const balance = await userSession.apiInstance.getBalance();
            if (balance < amount) {
                await this.bot.sendMessage(chatId, `💸 Insufficient balance!\n\nYou have: ${balance.toLocaleString()} K\nNeed: ${amount.toLocaleString()} K`);
                return;
            }

            let potentialProfit;
            let payoutRate;
            if (colour === "RED" || colour === "GREEN") {
                potentialProfit = Math.floor(amount * 0.96);
                payoutRate = "1.96x";
            } else if (colour === "VIOLET") {
                potentialProfit = Math.floor(amount * 0.44);
                payoutRate = "1.44x";
            }

            const platformName = '777 Big Win';

            const loadingMsg = await this.bot.sendMessage(chatId, `🎰 Placing ${colour} Bet\n\n• Game: ${gameType}\n• Issue: ${currentIssue}\n• Amount: ${amount.toLocaleString()} K\n• Payout: ${payoutRate}\n• Potential Profit: +${potentialProfit.toLocaleString()} K`);

            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                const betTypeStr = `${colour}`;
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const betText = `✅ Colour Bet Placed Successfully!\n\n• Game: ${gameType}\n• Issue: ${result.issueId}\n• Type: ${colour}\n• Amount: ${amount.toLocaleString()} K\n• Potential Profit: +${potentialProfit.toLocaleString()} K`;

                await this.bot.editMessageText(betText, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                await this.bot.editMessageText(`❌ ${colour} Bet Failed\n\nError: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            console.error(`💥 Colour bet error for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, `❌ ${colour} Bet Error\n\nError: ${error.message}`);
        }
    }

    async stopBot(chatId, userId) {
        try {
            console.log(`Stopping bot for user ${userId}`);
            
            if (autoBettingTasks[userId]) {
                delete autoBettingTasks[userId];
                console.log(`Auto betting task stopped for user ${userId}`);
            }
            
            if (waitingForResults[userId]) {
                delete waitingForResults[userId];
                console.log(`Waiting for results cleared for user ${userId}`);
            }
            
            if (issueCheckers[userId]) {
                delete issueCheckers[userId];
                console.log(`Issue checker stopped for user ${userId}`);
            }
            
            await this.saveBotSession(userId, false);
            console.log(`Bot session updated for user ${userId}`);
            
            const userSession = this.ensureUserSession(userId);
            let currentBalance = 0;
            let balanceText = "";
            
            if (userSession && userSession.loggedIn && userSession.apiInstance) {
                try {
                    currentBalance = await userSession.apiInstance.getBalance();
                    balanceText = `\n💰 Current Balance: ${currentBalance.toLocaleString()} K`;
                } catch (balanceError) {
                    console.error(`Error getting balance for user ${userId}:`, balanceError);
                    balanceText = "\n💰 Current Balance: Unable to check balance";
                }
            }
            
            const stopMessage = `🛑 Bot Stopped!${balanceText}`;
            console.log(`Sending stop message to user ${userId}`);
            
            await this.bot.sendMessage(chatId, stopMessage, {
                reply_markup: this.getMainKeyboard()
            });
            
            console.log(`Bot successfully stopped for user ${userId}`);
            
        } catch (error) {
            console.error(`Error in stopBot for user ${userId}:`, error);
            
            try {
                await this.bot.sendMessage(chatId, "❌ Bot stopped with some issues.\n\nPlease check if bot is still running.", {
                    reply_markup: this.getMainKeyboard()
                });
            } catch (sendError) {
                console.error(`Failed to send error message to user ${userId}:`, sendError);
            }
        }
    }

    startIssueChecker(userId) {
        if (issueCheckers[userId]) return;

        issueCheckers[userId] = true;
        console.log(`Started issue checker for user ${userId}`);

        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) return;

        let lastCheckedIssue = '';

        const checkLoop = async () => {
            if (!issueCheckers[userId]) return;

            try {
                const currentIssue = await userSession.apiInstance.getCurrentIssue();
                
                if (currentIssue && currentIssue !== lastCheckedIssue) {
                    console.log(`Issue changed from ${lastCheckedIssue} to ${currentIssue}, checking results for user ${userId}`);
                    
                    if (lastCheckedIssue) {
                        await this.checkSingleBetResult(userId, lastCheckedIssue);
                    }
                    lastCheckedIssue = currentIssue;
                }

                setTimeout(checkLoop, 3000);
            } catch (error) {
                console.error(`Issue checker error for user ${userId}:`, error);
                setTimeout(checkLoop, 10000);
            }
        };

        userSession.apiInstance.getCurrentIssue().then(issue => {
            if (issue) {
                lastCheckedIssue = issue;
                console.log(`Initial issue set to: ${issue} for user ${userId}`);
            }
            checkLoop();
        }).catch(error => {
            console.error(`Error getting initial issue for user ${userId}:`, error);
            setTimeout(checkLoop, 10000);
        });
    }

    async checkSingleBetResult(userId, issue) {
        try {
            console.log(`🔍 Checking bet result for user ${userId}, issue: ${issue}`);

            const userSession = userSessions[userId];
            if (!userSession || !userSession.apiInstance) {
                console.log(`❌ No user session or API instance for user ${userId}`);
                return;
            }

            const platform = userSession.platform || '777';
            const gameType = userSession.gameType || 'WINGO';
            
            const pendingBet = await this.db.get(
                'SELECT platform, issue, bet_type, amount FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                [userId, platform, issue]
            );

            if (!pendingBet) {
                console.log(`❌ No pending bet found for user ${userId}, issue ${issue}`);
                return;
            }

            console.log(`📝 Found pending bet: ${JSON.stringify(pendingBet)}`);

            const betTypeStr = pendingBet.bet_type;
            const amount = pendingBet.amount;

            if (amount === 0 && betTypeStr.includes("WAIT")) {
                console.log(`⏭️ Skipping wait mode bet for user ${userId}, issue ${issue}`);
                await this.db.run(
                    'DELETE FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                    [userId, platform, issue]
                );
                return;
            }

            const results = await userSession.apiInstance.getRecentResults(20);
            console.log(`📊 Retrieved ${results.length} recent results for user ${userId}`);

            if (results.length === 0) {
                console.log(`❌ No results found for user ${userId}`);
                return;
            }

            let betResult = "UNKNOWN";
            let profitLoss = 0;
            let resultNumber = "";
            let resultType = "";
            let resultColour = "";

            let resultFound = false;
            for (const result of results) {
                console.log(`🔍 Checking result: ${result.issueNumber} vs ${issue}`);
                
                if (result.issueNumber === issue) {
                    resultFound = true;
                    resultNumber = result.number || 'N/A';
                    console.log(`✅ Found matching result for issue ${issue}: number ${resultNumber}`);
                    
                    if (gameType === 'TRX') {
                        if (['0','1','2','3','4'].includes(resultNumber)) {
                            resultType = "SMALL";
                        } else {
                            resultType = "BIG";
                        }

                        if (['0','5'].includes(resultNumber)) {
                            resultColour = "VIOLET";
                        } else if (['1','3','7','9'].includes(resultNumber)) {
                            resultColour = "GREEN";
                        } else if (['2','4','6','8'].includes(resultNumber)) {
                            resultColour = "RED";
                        } else {
                            resultColour = "UNKNOWN";
                        }
                    } else if (gameType === 'WINGO_3MIN' || gameType === 'WINGO') {
                        if (['0','1','2','3','4'].includes(resultNumber)) {
                            resultType = "SMALL";
                        } else {
                            resultType = "BIG";
                        }

                        if (['0','5'].includes(resultNumber)) {
                            resultColour = "VIOLET";
                        } else if (['1','3','7','9'].includes(resultNumber)) {
                            resultColour = "GREEN";
                        } else if (['2','4','6','8'].includes(resultNumber)) {
                            resultColour = "RED";
                        } else {
                            resultColour = "UNKNOWN";
                        }
                    }

                    console.log(`🎯 Result analysis - Type: ${resultType}, Colour: ${resultColour}`);

                    if (betTypeStr.includes("BIG")) {
                        if (resultType === "BIG") {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 0.96);
                            console.log(`✅ BIG bet WON`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`❌ BIG bet LOST`);
                        }
                    } else if (betTypeStr.includes("SMALL")) {
                        if (resultType === "SMALL") {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 0.96);
                            console.log(`✅ SMALL bet WON`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`❌ SMALL bet LOST`);
                        }
                    } else if (betTypeStr.includes("RED")) {
                        if (resultColour === "RED") {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 0.96);
                            console.log(`✅ RED bet WON`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`❌ RED bet LOST`);
                        }
                    } else if (betTypeStr.includes("GREEN")) {
                        if (resultColour === "GREEN") {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 0.96);
                            console.log(`✅ GREEN bet WON`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`❌ GREEN bet LOST`);
                        }
                    } else if (betTypeStr.includes("VIOLET")) {
                        if (resultColour === "VIOLET") {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 0.44);
                            console.log(`✅ VIOLET bet WON`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`❌ VIOLET bet LOST`);
                        }
                    }
                    break;
                }
            }

            if (!resultFound) {
                console.log(`❌ Result not found for issue ${issue} in recent results`);
                return;
            }

            if (betResult === "UNKNOWN") {
                console.log(`❓ Unknown bet result for issue ${issue}`);
                return;
            }

            await this.db.run(
                'INSERT INTO bet_history (user_id, platform, issue, bet_type, amount, result, profit_loss) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, platform, issue, betTypeStr, amount, betResult, profitLoss]
            );
            console.log(`💾 Bet history saved for user ${userId}`);

            await this.db.run(
                'DELETE FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                [userId, platform, issue]
            );
            console.log(`🗑️ Pending bet removed for user ${userId}`);

            await this.updateBotStats(userId, profitLoss);
            console.log(`📈 Bot stats updated for user ${userId}`);

            console.log(`🔄 Calling updateBetSequence for user ${userId} with result: ${betResult}`);
            await this.updateBetSequence(userId, betResult);

            waitingForResults[userId] = false;
            console.log(`🔄 Reset waitingForResults for user ${userId}`);

            console.log(`📤 Sending result message to user ${userId}`);
            await this.sendResultMessage(userId, issue, betTypeStr, amount, betResult, profitLoss, resultNumber, resultType, resultColour);

            console.log(`✅ Bet result processed for user ${userId}: ${betResult} on issue ${issue}, Profit: ${profitLoss}`);
            
        } catch (error) {
            console.error(`💥 Error checking single bet result for user ${userId}, issue ${issue}:`, error);
            waitingForResults[userId] = false;
        }
    }

    async sendResultMessage(userId, issue, betTypeStr, amount, betResult, profitLoss, resultNumber, resultType, resultColour) {
        try {
            const userSession = userSessions[userId];
            if (!userSession) {
                console.log(`❌ No user session for sending message to ${userId}`);
                return;
            }

            const chatId = userId;
            const gameType = userSession.gameType || 'WINGO';

            let message = "";
            let emoji = "";

            if (betResult === "WIN") {
                emoji = "🎉";
                message = `${emoji} WIN! ${emoji}\n\n`;
                message += `✅ Your Bet: ${betTypeStr}\n`;
                message += `💰 Amount: ${amount.toLocaleString()} K\n`;
                message += `💵 Profit: +${profitLoss.toLocaleString()} K\n\n`;
            } else {
                emoji = "😢";
                message = `${emoji} LOSE ${emoji}\n\n`;
                message += `❌ Your Bet: ${betTypeStr}\n`;
                message += `💸 Amount: ${amount.toLocaleString()} K\n`;
                message += `📉 Loss: -${amount.toLocaleString()} K\n\n`;
            }

            message += `🎯 Result Details:\n`;
            message += `• Issue: ${issue}\n`;
            message += `• Number: ${resultNumber}\n`;
            message += `• Type: ${resultType}\n`;
            message += `• Colour: ${resultColour}\n`;
            message += `• Game: ${gameType}\n\n`;

            if (userSession.loggedIn && userSession.apiInstance) {
                try {
                    const currentBalance = await userSession.apiInstance.getBalance();
                    message += `💳 Current Balance: ${currentBalance.toLocaleString()} K\n\n`;
                    console.log(`💰 Balance retrieved: ${currentBalance} for user ${userId}`);
                } catch (balanceError) {
                    console.error(`❌ Error getting balance for result message:`, balanceError);
                    message += `💳 Current Balance: Unable to check balance\n\n`;
                }
            }

            message += `⏰ ${getMyanmarTime()}`;

            console.log(`📨 Sending message to user ${userId}: ${message.substring(0, 100)}...`);
            
            await this.bot.sendMessage(chatId, message, { 
                disable_notification: false
            });
            
            console.log(`✅ Result message sent successfully to user ${userId}`);

            if (amount > 0) {
                await this.sendSequenceInfo(userId, chatId, betResult);
            }

        } catch (error) {
            console.error(`💥 Error sending result message to user ${userId}:`, error);
            
            try {
                const simpleMessage = betResult === "WIN" ? 
                    `🎉 WIN! ${betTypeStr} bet on issue ${issue}. Profit: +${profitLoss}K` :
                    `😢 LOSE! ${betTypeStr} bet on issue ${issue}. Loss: -${amount}K`;
                    
                await this.bot.sendMessage(userId, simpleMessage);
                console.log(`✅ Simple message sent as fallback to user ${userId}`);
            } catch (fallbackError) {
                console.error(`💥 Even simple message failed for user ${userId}:`, fallbackError);
            }
        }
    }

    async sendSequenceInfo(userId, chatId, betResult) {
        try {
            const userSession = userSessions[userId];
            if (!userSession) return;

            const slSession = await this.getSlBetSession(userId);
            
            if (!slSession.is_wait_mode) {
                const newIndex = await this.updateBetSequence(userId, betResult);
                const betSequence = await this.getUserSetting(userId, 'bet_sequence', '');
                const amounts = betSequence.split(',').map(x => parseInt(x.trim()));
                const nextAmount = amounts[newIndex] || amounts[0];

                let sequenceMessage = "";
                if (betResult === "WIN") {
                    sequenceMessage = `🔄 Sequence Reset to Step 1\n`;
                } else {
                    sequenceMessage = `📈 Next Bet: Step ${newIndex + 1} (${nextAmount.toLocaleString()} K)\n`;
                }

                sequenceMessage += `🎯 Bet Sequence: ${betSequence}`;

                await this.bot.sendMessage(chatId, sequenceMessage);
            }

        } catch (error) {
            console.error(`Error sending sequence info to user ${userId}:`, error);
        }
    }

    async updateBetSequence(userId, result) {
        try {
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '');
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

            console.log(`🔄 Updating bet sequence for user ${userId}: currentIndex=${currentIndex}, result=${result}`);

            let newIndex;
            if (result === "WIN") {
                newIndex = 0;
                console.log(`✅ Win - Reset sequence to step 1`);
            } else {
                newIndex = currentIndex + 1;
                if (newIndex >= amounts.length) {
                    newIndex = 0;
                    console.log(`🔄 Loss - Reached end of sequence, reset to step 1`);
                } else {
                    console.log(`📈 Loss - Move to next step: ${currentIndex} -> ${newIndex}`);
                }
            }

            await this.saveUserSetting(userId, 'current_bet_index', newIndex);
            console.log(`💾 Saved new bet index: ${newIndex} for user ${userId}`);
            
            return newIndex;

        } catch (error) {
            console.error(`❌ Error updating bet sequence for user ${userId}:`, error);
            return 0;
        }
    }

    async updateBotStats(userId, profit = 0) {
        try {
            const session = await this.getBotSession(userId);
            const newTotalBets = session.total_bets + 1;
            const newTotalProfit = session.total_profit + profit;
            
            let newSessionProfit = session.session_profit;
            let newSessionLoss = session.session_loss;
            
            if (profit > 0) {
                newSessionProfit += profit;
            } else {
                newSessionLoss += Math.abs(profit);
            }
            
            await this.saveBotSession(userId, true, newTotalBets, newTotalProfit, newSessionProfit, newSessionLoss);
            
        } catch (error) {
            console.error(`Error updating bot stats for user ${userId}:`, error);
        }
    }

    async runBot(chatId, userId) {
        try {
            const userSession = this.ensureUserSession(userId);
            
            if (!userSession.loggedIn) {
                await this.bot.sendMessage(chatId, "Please login first!");
                return;
            }

            if (autoBettingTasks[userId]) {
                await this.bot.sendMessage(chatId, "Bot is already running!");
                return;
            }

            autoBettingTasks[userId] = true;
            waitingForResults[userId] = false;

            await this.resetSessionStats(userId);
            await this.saveBotSession(userId, true);

            const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
            let modeText;
            switch(randomMode) {
                case 'big':
                    modeText = "Random BIG Only";
                    break;
                case 'small':
                    modeText = "Random SMALL Only";
                    break;
                case 'bot':
                    modeText = "Random Bot";
                    break;
                case 'follow':
                    modeText = "Follow Bot";
                    break;
                case 'bs_formula':
                    const patternsData = await this.getFormulaPatterns(userId);
                    modeText = `BS Formula (${patternsData.bs_pattern})`;
                    break;
                case 'colour_formula':
                    const colourPatternsData = await this.getFormulaPatterns(userId);
                    modeText = `Colour Formula (${colourPatternsData.colour_pattern})`;
                    break;
                default:
                    modeText = "Random Bot";
            }

            const startMessage = `🚀 Auto Bot Started!\n\n• Game Type: ${userSession.gameType || 'WINGO'}\n• Mode: ${modeText}`;
            await this.bot.sendMessage(chatId, startMessage);

            this.startAutoBetting(userId);
            
        } catch (error) {
            console.error(`Error running bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error starting bot.\n\nPlease try again.");
        }
    }

    startAutoBetting(userId) {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) {
            console.log(`❌ No user session or API instance for user ${userId}`);
            return;
        }

        let lastIssue = "";
        let consecutiveFailures = 0;
        const maxFailures = 3;

        const bettingLoop = async () => {
            if (!autoBettingTasks[userId]) {
                console.log(`🛑 Auto betting stopped for user ${userId}`);
                return;
            }

            try {
                if (waitingForResults[userId]) {
                    console.log(`⏳ User ${userId} waiting for results, checking again in 3 seconds`);
                    setTimeout(bettingLoop, 3000);
                    return;
                }

                const currentIssue = await userSession.apiInstance.getCurrentIssue();
                console.log(`🔍 Current issue for user ${userId}: ${currentIssue}, last issue: ${lastIssue}`);
                
                if (currentIssue && currentIssue !== lastIssue) {
                    console.log(`🆕 New issue detected: ${currentIssue} for user ${userId}`);
                    
                    setTimeout(async () => {
                        try {
                            if (!autoBettingTasks[userId]) return;

                            if (!(await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue))) {
                                console.log(`🎯 Placing bet for user ${userId} on issue ${currentIssue}`);
                                await this.placeAutoBet(userId, currentIssue);
                                lastIssue = currentIssue;
                                consecutiveFailures = 0;
                            } else {
                                console.log(`⏭️ User ${userId} already bet on issue ${currentIssue}`);
                            }
                            
                            setTimeout(bettingLoop, 2000);
                        } catch (error) {
                            console.error(`❌ Error in betting timeout for user ${userId}:`, error);
                            setTimeout(bettingLoop, 5000);
                        }
                    }, 2000);
                } else {
                    console.log(`🔄 Same issue or no issue for user ${userId}, checking again in 3 seconds`);
                    setTimeout(bettingLoop, 3000);
                }
            } catch (error) {
                console.error(`❌ Auto betting error for user ${userId}:`, error);
                consecutiveFailures++;
                
                if (consecutiveFailures >= maxFailures) {
                    console.log(`🛑 Too many errors, stopping bot for user ${userId}`);
                    this.bot.sendMessage(userId, "❌ Auto Bot Stopped - Too many errors!").catch(console.error);
                    delete autoBettingTasks[userId];
                    delete waitingForResults[userId];
                    this.saveBotSession(userId, false);
                } else {
                    console.log(`🔄 Retrying after error for user ${userId} (${consecutiveFailures}/${maxFailures})`);
                    setTimeout(bettingLoop, 5000);
                }
            }
        };

        console.log(`🚀 Starting auto betting loop for user ${userId}`);
        bettingLoop();
    }

    async placeAutoBet(userId, issue) {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.loggedIn) {
            console.log(`❌ User ${userId} not logged in for auto bet`);
            return;
        }

        waitingForResults[userId] = true;

        const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
        
        let betType, betTypeStr;

        console.log(`🎯 Auto betting for user ${userId}, mode: ${randomMode}, game: ${userSession.gameType}`);

        try {
            switch(randomMode) {
                case 'big':
                    betType = 13;
                    betTypeStr = "BIG";
                    break;
                case 'small':
                    betType = 14;
                    betTypeStr = "SMALL";
                    break;
                case 'follow':
                    const followResult = await this.getFollowBetType(userSession.apiInstance);
                    betType = followResult.betType;
                    betTypeStr = followResult.betTypeStr;
                    break;
                case 'bs_formula':
                    const bsResult = await this.getBsFormulaBetType(userId);
                    betType = bsResult.betType;
                    betTypeStr = bsResult.betTypeStr;
                    break;
                case 'colour_formula':
                    const colourResult = await this.getColourFormulaBetType(userId);
                    betType = colourResult.betType;
                    betTypeStr = colourResult.betTypeStr;
                    break;
                default:
                    betType = Math.random() < 0.5 ? 13 : 14;
                    betTypeStr = betType === 13 ? "BIG" : "SMALL";
            }

            console.log(`🎲 Selected bet type: ${betType} (${betTypeStr}) for user ${userId}`);

            if (userSession.gameType === 'TRX' && (betType === 10 || betType === 11 || betType === 12)) {
                console.log(`🔄 TRX game - Converting colour bet to BIG/SMALL for user ${userId}`);
                betType = Math.random() < 0.5 ? 13 : 14;
                betTypeStr = `${betType === 13 ? 'BIG' : 'SMALL'} (Colour Formula Converted)`;
            }

            const amount = await this.getCurrentBetAmount(userId);
            console.log(`💰 Bet amount for user ${userId}: ${amount} (from sequence)`);

            const balance = await userSession.apiInstance.getBalance();

            if (amount > 0 && balance < amount) {
                console.log(`💸 Insufficient balance for user ${userId}: ${balance} < ${amount}`);
                this.bot.sendMessage(userId, `💸 Insufficient Balance!\n\nNeed: ${amount.toLocaleString()} K\nAvailable: ${balance.toLocaleString()} K`).catch(console.error);
                delete autoBettingTasks[userId];
                waitingForResults[userId] = false;
                return;
            }

            const botSession = await this.getBotSession(userId);
            const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
            const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);
            
            const netProfit = botSession.session_profit - botSession.session_loss;
            
            if (profitTarget > 0 && netProfit >= profitTarget) {
                console.log(`🎯 Profit target reached for user ${userId}: ${netProfit} >= ${profitTarget}`);
                this.bot.sendMessage(userId, `🎯 Profit Target Reached!\n\n💰 Current Profit: ${netProfit.toLocaleString()} K\n🎯 Target: ${profitTarget.toLocaleString()} K\n\n🤖 Auto bot stopped automatically.`).catch(console.error);
                delete autoBettingTasks[userId];
                waitingForResults[userId] = false;
                await this.saveBotSession(userId, false);
                return;
            }
            
            if (lossTarget > 0 && botSession.session_loss >= lossTarget) {
                console.log(`🛑 Loss target reached for user ${userId}: ${botSession.session_loss} >= ${lossTarget}`);
                this.bot.sendMessage(userId, `🛑 Loss Target Reached!\n\n📉 Current Loss: ${botSession.session_loss.toLocaleString()} K\n🛑 Target: ${lossTarget.toLocaleString()} K\n\n🤖 Auto bot stopped automatically.`).catch(console.error);
                delete autoBettingTasks[userId];
                waitingForResults[userId] = false;
                await this.saveBotSession(userId, false);
                return;
            }

            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '');
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));
            const totalSteps = amounts.length;
            
            const betMessage = `🎰 Placing Auto Bet\n\n• Type: ${betTypeStr}\n• Amount: ${amount.toLocaleString()} K\n• Step: ${currentIndex + 1}/${totalSteps}\n• Issue: ${issue}`;
            await this.bot.sendMessage(userId, betMessage);

            console.log(`📤 Placing bet for user ${userId}: ${betTypeStr} ${amount}K on ${issue} (Step ${currentIndex + 1}/${totalSteps})`);
            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                console.log(`✅ Bet placed successfully for user ${userId}`);
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    console.log(`🔍 Starting issue checker for user ${userId}`);
                    this.startIssueChecker(userId);
                }

                const successMessage = `✅ Bet Placed Successfully!\n\n• Issue: ${result.issueId}\n• Type: ${betTypeStr}\n• Amount: ${amount.toLocaleString()} K\n• Step: ${currentIndex + 1}/${totalSteps}`;
                await this.bot.sendMessage(userId, successMessage);
                
            } else {
                console.log(`❌ Bet failed for user ${userId}: ${result.message}`);
                
                if (result.message.includes('amount') || result.message.includes('betting')) {
                    console.log(`🔄 Amount error detected, resetting bet sequence for user ${userId}`);
                    await this.saveUserSetting(userId, 'current_bet_index', 0);
                    
                    const errorMessage = `❌ Bet Failed - Amount Error\n\nError: ${result.message}\n\n🔄 Bet sequence has been reset to step 1.`;
                    await this.bot.sendMessage(userId, errorMessage);
                } else {
                    const errorMessage = `❌ Bet Failed\n\nError: ${result.message}`;
                    await this.bot.sendMessage(userId, errorMessage);
                }
                
                waitingForResults[userId] = false;
            }
        } catch (error) {
            console.error(`❌ Error in placeAutoBet for user ${userId}:`, error);
            waitingForResults[userId] = false;
        }
    }

    async getFollowBetType(apiInstance) {
        try {
            const results = await apiInstance.getRecentResults(1);
            if (!results || results.length === 0) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
            }

            const lastResult = results[0];
            const number = lastResult.number || '';
            
            if (['0','1','2','3','4'].includes(number)) {
                return { betType: 14, betTypeStr: "SMALL (Follow)" };
            } else {
                return { betType: 13, betTypeStr: "BIG (Follow)" };
            }
        } catch (error) {
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async getCurrentBetAmount(userId) {
        try {
            const userSession = this.ensureUserSession(userId);
            const gameType = userSession.gameType || 'WINGO';
            
            let defaultSequence;
            if (gameType === 'WINGO_3MIN') {
                defaultSequence = '100,500,1000,5000';
            } else if (gameType === 'TRX') {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            } else {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            }
            
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', defaultSequence);
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));
            
            if (currentIndex < amounts.length) {
                const amount = amounts[currentIndex];
                console.log(`💰 Current bet amount for ${gameType}: ${amount}K (index: ${currentIndex})`);
                return amount;
            } else {
                const amount = amounts[0] || 100;
                await this.saveUserSetting(userId, 'current_bet_index', 0);
                console.log(`💰 Reset to default bet amount for ${gameType}: ${amount}K`);
                return amount;
            }
        } catch (error) {
            console.error(`Error getting current bet amount for ${userId}:`, error);
            return 100;
        }
    }

    async isGameIdAllowed(gameId) {
        try {
            const allowedIds = await this.getAllowedGameIds();
            const gameIdStr = String(gameId).trim();
            const allowedIdsStr = allowedIds.map(id => String(id).trim());
            return allowedIdsStr.includes(gameIdStr);
        } catch (error) {
            console.error(`Error checking if game ID ${gameId} is allowed:`, error);
            return false;
        }
    }

    async getAllowedGameIds() {
        try {
            const results = await this.db.all('SELECT game_id FROM allowed_game_ids ORDER BY added_at DESC');
            return results.map(row => row.game_id);
        } catch (error) {
            console.error('Error getting allowed game IDs:', error);
            return [];
        }
    }

    async hasUserBetOnIssue(userId, platform, issue) {
        try {
            const result = await this.db.get(
                'SELECT issue FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                [userId, platform, issue]
            );
            return result !== undefined;
        } catch (error) {
            console.error(`Error checking if user ${userId} bet on issue ${issue}:`, error);
            return false;
        }
    }

    async savePendingBet(userId, platform, issue, betType, amount) {
        try {
            await this.db.run(
                'INSERT INTO pending_bets (user_id, platform, issue, bet_type, amount) VALUES (?, ?, ?, ?, ?)',
                [userId, platform, issue, betType, amount]
            );
            return true;
        } catch (error) {
            console.error(`Error saving pending bet for user ${userId}:`, error);
            return false;
        }
    }

    async saveUserCredentials(userId, phone, password, platform = '777') {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO users (user_id, phone, password, platform) VALUES (?, ?, ?, ?)',
                [userId, phone, password, platform]
            );
            return true;
        } catch (error) {
            console.error(`Error saving user credentials for ${userId}:`, error);
            return false;
        }
    }

    async saveUserSetting(userId, key, value) {
        try {
            const existing = await this.db.get('SELECT user_id FROM user_settings WHERE user_id = ?', [userId]);
            if (!existing) {
                await this.db.run('INSERT INTO user_settings (user_id) VALUES (?)', [userId]);
            }

            await this.db.run(`UPDATE user_settings SET ${key} = ? WHERE user_id = ?`, [value, userId]);
            return true;
        } catch (error) {
            console.error(`Error saving user setting for ${userId}, key ${key}:`, error);
            return false;
        }
    }

    async getUserSetting(userId, key, defaultValue = null) {
        try {
            const result = await this.db.get(`SELECT ${key} FROM user_settings WHERE user_id = ?`, [userId]);
            return result ? result[key] : defaultValue;
        } catch (error) {
            console.error(`Error getting user setting for ${userId}, key ${key}:`, error);
            return defaultValue;
        }
    }

    async getCurrentBetSequenceIndex(userId) {
        try {
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            return currentIndex;
        } catch (error) {
            console.error(`Error getting current bet sequence index for user ${userId}:`, error);
            return 0;
        }
    }

    async saveBotSession(userId, isRunning = false, totalBets = 0, totalProfit = 0, sessionProfit = 0, sessionLoss = 0) {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO bot_sessions (user_id, is_running, total_bets, total_profit, session_profit, session_loss, last_activity) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [userId, isRunning ? 1 : 0, totalBets, totalProfit, sessionProfit, sessionLoss]
            );
            console.log(`Bot session saved for user ${userId}, running: ${isRunning}`);
            return true;
        } catch (error) {
            console.error(`Error saving bot session for user ${userId}:`, error);
            return false;
        }
    }

    async getBotSession(userId) {
        try {
            const result = await this.db.get(
                'SELECT is_running, total_bets, total_profit, session_profit, session_loss FROM bot_sessions WHERE user_id = ?',
                [userId]
            );
            
            if (result) {
                return {
                    is_running: Boolean(result.is_running),
                    total_bets: result.total_bets || 0,
                    total_profit: result.total_profit || 0,
                    session_profit: result.session_profit || 0,
                    session_loss: result.session_loss || 0
                };
            }
            
            return { is_running: false, total_bets: 0, total_profit: 0, session_profit: 0, session_loss: 0 };
        } catch (error) {
            console.error(`Error getting bot session for user ${userId}:`, error);
            return { is_running: false, total_bets: 0, total_profit: 0, session_profit: 0, session_loss: 0 };
        }
    }

    async resetSessionStats(userId) {
        try {
            await this.saveBotSession(userId, false, 0, 0, 0, 0);
            return true;
        } catch (error) {
            console.error(`Error resetting session stats for user ${userId}:`, error);
            return false;
        }
    }

    async getSlBetSession(userId) {
        try {
            const result = await this.db.get(
                'SELECT is_wait_mode, wait_bet_type, wait_issue, wait_amount, wait_total_profit FROM sl_bet_sessions WHERE user_id = ?',
                [userId]
            );
            
            if (result) {
                return {
                    is_wait_mode: Boolean(result.is_wait_mode),
                    wait_bet_type: result.wait_bet_type || '',
                    wait_issue: result.wait_issue || '',
                    wait_amount: result.wait_amount || 0,
                    wait_total_profit: result.wait_total_profit || 0
                };
            }
            
            return { is_wait_mode: false, wait_bet_type: '', wait_issue: '', wait_amount: 0, wait_total_profit: 0 };
        } catch (error) {
            console.error(`Error getting SL bet session for user ${userId}:`, error);
            return { is_wait_mode: false, wait_bet_type: '', wait_issue: '', wait_amount: 0, wait_total_profit: 0 };
        }
    }

    async setRandomBig(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'big');
            await this.clearFormulaPatterns(userId);
            
            await this.bot.sendMessage(chatId, "✅ Random Mode Set\n\n- 🎯 Random BIG - Always bet BIG\n\n🤖 Bot will now always bet BIG in auto mode.");
        } catch (error) {
            console.error(`Error setting random big for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting random mode. Please try again.");
        }
    }

    async setRandomSmall(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'small');
            await this.clearFormulaPatterns(userId);
            
            await this.bot.sendMessage(chatId, "✅ Random Mode Set\n\n- 🎯 Random SMALL - Always bet SMALL\n\n🤖 Bot will now always bet SMALL in auto mode.");
        } catch (error) {
            console.error(`Error setting random small for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting random mode. Please try again.");
        }
    }

    async setRandomBot(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'bot');
            await this.clearFormulaPatterns(userId);
            
            await this.bot.sendMessage(chatId, "✅ Random Mode Set\n\n- 🎯 Random Bot - Random BIG/SMALL\n\n🤖 Bot will now randomly choose between BIG and SMALL in auto mode.");
        } catch (error) {
            console.error(`Error setting random bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting random mode. Please try again.");
        }
    }

    async setFollowBot(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'follow');
            await this.clearFormulaPatterns(userId);
            
            await this.bot.sendMessage(chatId, "✅ Random Mode Set\n\n- 🎯 Follow Bot - Follow Last Result\n\n🤖 Bot will now follow the last game result in auto mode.");
        } catch (error) {
            console.error(`Error setting follow bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting random mode. Please try again.");
        }
    }

    async getFormulaPatterns(userId) {
        try {
            const result = await this.db.get(
                'SELECT bs_pattern, colour_pattern, bs_current_index, colour_current_index FROM formula_patterns WHERE user_id = ?',
                [userId]
            );
            
            if (result) {
                return {
                    bs_pattern: result.bs_pattern || "",
                    colour_pattern: result.colour_pattern || "",
                    bs_current_index: result.bs_current_index || 0,
                    colour_current_index: result.colour_current_index || 0
                };
            }
            
            return { bs_pattern: "", colour_pattern: "", bs_current_index: 0, colour_current_index: 0 };
        } catch (error) {
            console.error(`Error getting formula patterns for user ${userId}:`, error);
            return { bs_pattern: "", colour_pattern: "", bs_current_index: 0, colour_current_index: 0 };
        }
    }

    async clearFormulaPatterns(userId, patternType = null) {
        try {
            if (patternType === 'bs') {
                await this.db.run('UPDATE formula_patterns SET bs_pattern = "", bs_current_index = 0 WHERE user_id = ?', [userId]);
            } else if (patternType === 'colour') {
                await this.db.run('UPDATE formula_patterns SET colour_pattern = "", colour_current_index = 0 WHERE user_id = ?', [userId]);
            } else {
                await this.db.run('UPDATE formula_patterns SET bs_pattern = "", colour_pattern = "", bs_current_index = 0, colour_current_index = 0 WHERE user_id = ?', [userId]);
            }
            return true;
        } catch (error) {
            console.error(`Error clearing formula patterns for user ${userId}:`, error);
            return false;
        }
    }

    async getSlPattern(userId) {
        try {
            const result = await this.db.get(
                'SELECT pattern, current_sl, current_index, wait_loss_count, bet_count FROM sl_patterns WHERE user_id = ?',
                [userId]
            );
            
            if (result) {
                let pattern = result.pattern || '';
                if (pattern === '1,2,3,4,5') {
                    pattern = '';
                }
                
                return {
                    pattern: pattern,
                    current_sl: result.current_sl || 1,
                    current_index: result.current_index || 0,
                    wait_loss_count: result.wait_loss_count || 0,
                    bet_count: result.bet_count || 0
                };
            }
            
            return { pattern: '', current_sl: 1, current_index: 0, wait_loss_count: 0, bet_count: 0 };
        } catch (error) {
            console.error(`Error getting SL pattern for user ${userId}:`, error);
            return { pattern: '', current_sl: 1, current_index: 0, wait_loss_count: 0, bet_count: 0 };
        }
    }

    async getBetHistory(userId, platform = null, limit = 10) {
        try {
            if (platform) {
                return await this.db.all(
                    'SELECT platform, issue, bet_type, amount, result, profit_loss, created_at FROM bet_history WHERE user_id = ? AND platform = ? ORDER BY created_at DESC LIMIT ?',
                    [userId, platform, limit]
                );
            } else {
                return await this.db.all(
                    'SELECT platform, issue, bet_type, amount, result, profit_loss, created_at FROM bet_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
                    [userId, limit]
                );
            }
        } catch (error) {
            console.error(`Error getting bet history for user ${userId}:`, error);
            return [];
        }
    }

    async showBotSettings(chatId, userId) {
        try {
            const userSession = this.ensureUserSession(userId);
            const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            
            let defaultSequence;
            if (userSession.gameType === 'WINGO_3MIN') {
                defaultSequence = '100,500,1000,5000';
            } else if (userSession.gameType === 'TRX') {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            } else {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            }
            
            const currentAmount = await this.getCurrentBetAmount(userId);
            
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern || "Not set";
            const colourPattern = patternsData.colour_pattern || "Not set";
            
            const slPatternData = await this.getSlPattern(userId);
            const slPattern = slPatternData.pattern || "Not set";
            
            const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
            const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);
            const gameType = userSession.gameType || 'WINGO';

            const botSession = await this.getBotSession(userId);

            let modeText;
            let formulaStatus = "";
            
            switch(randomMode) {
                case 'big':
                    modeText = "Random BIG Only";
                    break;
                case 'small':
                    modeText = "Random SMALL Only";
                    break;
                case 'bot':
                    modeText = "Random Bot";
                    break;
                case 'follow':
                    modeText = "Follow Bot";
                    break;
                case 'bs_formula':
                    modeText = "BS Formula";
                    formulaStatus += `\n- BS Formula: ACTIVE (${bsPattern})`;
                    break;
                case 'colour_formula':
                    modeText = "Colour Formula";
                    formulaStatus += `\n- Colour Formula: ACTIVE (${colourPattern})`;
                    break;
                default:
                    modeText = "Random Bot";
            }
            
            if (bsPattern && bsPattern !== "Not set" && randomMode !== 'bs_formula') {
                formulaStatus += `\n- BS Formula: INACTIVE (${bsPattern})`;
            }
            if (colourPattern && colourPattern !== "Not set" && randomMode !== 'colour_formula') {
                formulaStatus += `\n- Colour Formula: INACTIVE (${colourPattern})`;
            }
            
            let slStatus = "";
            if (slPattern && slPattern !== "Not set" && slPattern !== "1,2,3,4,5") {
                slStatus = `\n- SL Layer: READY (${slPattern})`;
            }

            const displaySequence = betSequence || defaultSequence;
            const amounts = displaySequence.split(',').map(x => {
                const num = parseInt(x.trim());
                return isNaN(num) ? 0 : num;
            });
            
            let formattedSequence = "";
            amounts.forEach((amount, index) => {
                if (index === currentIndex) {
                    formattedSequence += `▶️ ${amount.toLocaleString()}`;
                } else {
                    formattedSequence += `${amount.toLocaleString()}`;
                }
                if (index < amounts.length - 1) {
                    formattedSequence += " → ";
                }
            });

            const settingsText = `🤖 Bot Settings

Current Settings:
- 🎮 Game Type: ${gameType}
- 🎯 Betting Mode: ${modeText}
- 💰 Bet Sequence: ${formattedSequence}
- 🔢 Current Step: ${currentIndex + 1}/${amounts.length}
- 🚀 Bot Status: ${botSession.is_running ? 'RUNNING' : 'STOPPED'}${formulaStatus}${slStatus}

Profit/Loss Targets:
- 🎯 Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}
- 🛑 Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}

Bot Statistics:
- 📈 Session Profit: ${botSession.session_profit.toLocaleString()} K
- 📉 Session Loss: ${botSession.session_loss.toLocaleString()} K
- 💵 Net Profit: ${(botSession.session_profit - botSession.session_loss).toLocaleString()} K
- 🔢 Total Bets: ${botSession.total_bets}

Choose your betting mode:`;

            await this.bot.sendMessage(chatId, settingsText, {
                reply_markup: this.getBotSettingsKeyboard()
            });
        } catch (error) {
            console.error(`Error showing bot settings for user ${userId}:`, error);
            console.error('Error details:', error.stack);
            await this.bot.sendMessage(chatId, "❌ Error loading bot settings. Please try again.");
        }
    }

    async showMyBets(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "🔐 Please login first!");
            return;
        }

        try {
            const platform = userSession.platform || '777';
            const myBets = await this.getBetHistory(userId, platform, 10);
            
            if (!myBets || myBets.length === 0) {
                await this.bot.sendMessage(chatId, "📭 No bet history found.");
                return;
            }

            const platformName = '777 Big Win';
            const gameType = userSession.gameType || 'WINGO';

            let betsText = `📊 Your Recent Bets - ${platformName} (${gameType})\n\n`;
            
            let totalProfit = 0;
            let winCount = 0;
            let loseCount = 0;
            
            myBets.forEach((bet, i) => {
                const resultText = bet.result === "WIN" ? 
                    `🟢 WIN (+${(bet.profit_loss).toLocaleString()}K)` : 
                    `🔴 LOSE (-${bet.amount.toLocaleString()}K)`;
                
                const timeStr = bet.created_at.split(' ')[1]?.substring(0, 5) || bet.created_at.substring(11, 16);
                betsText += `${i+1}. ${bet.issue} - ${bet.bet_type} - ${bet.amount.toLocaleString()}K - ${resultText}\n`;
                
                if (bet.result === "WIN") {
                    winCount++;
                    totalProfit += bet.profit_loss;
                } else {
                    loseCount++;
                    totalProfit -= bet.amount;
                }
            });

            betsText += `\nSummary:\n`;
            betsText += `✅ Wins: ${winCount}\n`;
            betsText += `❌ Losses: ${loseCount}\n`;
            betsText += `📊 Total Bets: ${myBets.length}\n`;
            betsText += `💰 Net Profit: ${totalProfit.toLocaleString()} K\n`;
            betsText += `🎯 Win Rate: ${Math.round((winCount / myBets.length) * 100)}%`;

            await this.bot.sendMessage(chatId, betsText);
        } catch (error) {
            console.error(`Error showing my bets for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error getting bet history. Please try again.");
        }
    }

    async showSlLayer(chatId, userId) {
        try {
            const slPatternData = await this.getSlPattern(userId);
            const patternsData = await this.getFormulaPatterns(userId);
            
            const patternText = slPatternData.pattern || "Not set";
            const currentSl = slPatternData.current_sl;
            const currentIndex = slPatternData.current_index;
            const waitLossCount = slPatternData.wait_loss_count;
            const betCount = slPatternData.bet_count;
            
            const bsPatternActive = Boolean(patternsData.bs_pattern && patternsData.bs_pattern !== "Not set");
            const colourPatternActive = Boolean(patternsData.colour_pattern && patternsData.colour_pattern !== "Not set");
            
            let activationStatus = "";
            let readyForSl = true;
            
            if (!slPatternData.pattern || slPatternData.pattern === '1,2,3,4,5') {
                activationStatus += "❌ SL Pattern not set\n";
                readyForSl = false;
            } else {
                activationStatus += "✅ SL Pattern ready\n";
            }
            
            if (!bsPatternActive && !colourPatternActive) {
                activationStatus += "❌ BS/Colour Pattern not set\n";
                readyForSl = false;
            } else {
                activationStatus += "✅ BS/Colour Pattern ready\n";
            }
            
            const overallStatus = readyForSl ? "🟢 READY FOR SL LAYER" : "🔴 Not Ready";
            
            const activePatternType = bsPatternActive ? "BS Formula" : "Colour Formula";
            const activePattern = bsPatternActive ? patternsData.bs_pattern : patternsData.colour_pattern;
            
            const slInfo = `🎯 SL Layer Bot System\n\nStatus: ${overallStatus}\n\nActivation Status:\n${activationStatus}\nCurrent Settings:\n- ${activePatternType}: ${activePattern}\n- SL Pattern: ${patternText}\n- Current SL Level: ${currentSl}\n- Wait Loss Count: ${waitLossCount}\n- Bet Count: ${betCount}/3\n\nHow to activate:\n1. Set your SL Pattern\n2. Set BS or Colour Pattern\n3. Press Run Bot\n4. System automatically activates SL Layer`;

            await this.bot.sendMessage(chatId, slInfo, {
                reply_markup: this.getSlLayerKeyboard()
            });
        } catch (error) {
            console.error(`Error showing SL layer for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error loading SL layer. Please try again.");
        }
    }

    async showBotInfo(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        
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
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const currentAmount = await this.getCurrentBetAmount(userId);
            
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern || "";
            const colourPattern = patternsData.colour_pattern || "";
            
            const slPatternData = await this.getSlPattern(userId);
            const slPattern = slPatternData.pattern || "";
            
            const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
            const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);

            const netProfit = botSession.session_profit - botSession.session_loss;
            
            let modeText = "";
            if (bsPattern && bsPattern !== "") {
                modeText = `BS Formula: ${bsPattern}`;
            } else if (colourPattern && colourPattern !== "") {
                modeText = `Colour Formula: ${colourPattern}`;
            } else {
                const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
                modeText = {
                    'big': "Random BIG Only",
                    'small': "Random SMALL Only", 
                    'bot': "Random Bot",
                    'follow': "Follow Bot"
                }[randomMode] || "Random Bot";
            }

            const botInfoText = `🤖 BOT INFORMATION\n\nUser Info:\n- 🆔 User ID: ${user_id_display}\n- 📱 Phone: ${phone}\n- 🎮 Platform: ${platformName}\n- 🎯 Game Type: ${gameType}\n- 💰 Balance: ${balance.toLocaleString()} K\n\nBot Settings:\n- 🎯 Betting Mode: ${modeText}\n- 💰 Bet Sequence: ${betSequence}\n- 🔢 Current Bet: ${currentAmount.toLocaleString()} K (Step ${currentIndex + 1})\n- 🚀 Bot Status: ${botSession.is_running ? 'RUNNING' : 'STOPPED'}\n\nSL Layer:\n- 🎯 SL Pattern: ${slPattern || 'Not set'}\n- 📊 Current SL: ${slPatternData.current_sl}\n\nTargets:\n- 🎯 Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}\n- 🛑 Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}\n\nStatistics:\n- 📈 Session Profit: ${botSession.session_profit.toLocaleString()} K\n- 📉 Session Loss: ${botSession.session_loss.toLocaleString()} K\n- 💵 Net Profit: ${netProfit.toLocaleString()} K\n- 🔢 Total Bets: ${botSession.total_bets}\n\n⏰ Last Update: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, botInfoText);
            
        } catch (error) {
            console.error("Error in showBotInfo:", error);
            await this.bot.sendMessage(chatId, "❌ Error loading bot information. Please try again.");
        }
    }

    async showBsFormula(chatId, userId) {
        await this.bot.sendMessage(chatId, "BS Formula feature will be implemented soon.", {
            reply_markup: this.getBsPatternKeyboard()
        });
    }

    async showColourFormula(chatId, userId) {
        await this.bot.sendMessage(chatId, "Colour Formula feature will be implemented soon.", {
            reply_markup: this.getColourPatternKeyboard()
        });
    }

    async showBotStats(chatId, userId) {
        await this.bot.sendMessage(chatId, "Bot stats feature will be implemented soon.", {
            reply_markup: this.getBotSettingsKeyboard()
        });
    }

    async resetBotStats(chatId, userId) {
        await this.bot.sendMessage(chatId, "Reset stats feature will be implemented soon.", {
            reply_markup: this.getBotSettingsKeyboard()
        });
    }

    async viewBsPattern(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern;
            const currentIndex = patternsData.bs_current_index;
            
            if (!bsPattern) {
                await this.bot.sendMessage(chatId, "❌ No BS Pattern Set!\n\nPlease set a BS pattern first using 'Set BS Pattern'.");
                return;
            }

            const patternArray = bsPattern.split(',');
            let patternDisplay = "";
            
            patternArray.forEach((betType, index) => {
                if (index === currentIndex) {
                    patternDisplay += `▶️ ${betType}`;
                } else {
                    patternDisplay += betType;
                }
                if (index < patternArray.length - 1) {
                    patternDisplay += " → ";
                }
            });

            const patternInfo = `📊 Current BS Pattern\n\n🎯 Pattern: ${patternDisplay}\n📏 Total Steps: ${patternArray.length}\n🔢 Current Step: ${currentIndex + 1}\n\nNext Bet: ${patternArray[currentIndex] === 'B' ? 'BIG' : 'SMALL'}`;

            await this.bot.sendMessage(chatId, patternInfo);
            
        } catch (error) {
            console.error(`Error viewing BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error viewing BS pattern. Please try again.");
        }
    }

    async viewColourPattern(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const colourPattern = patternsData.colour_pattern;
            const currentIndex = patternsData.colour_current_index;
            
            if (!colourPattern) {
                await this.bot.sendMessage(chatId, "❌ No Colour Pattern Set!\n\nPlease set a Colour pattern first using 'Set Colour Pattern'.");
                return;
            }

            const patternArray = colourPattern.split(',');
            let patternDisplay = "";
            
            patternArray.forEach((colour, index) => {
                if (index === currentIndex) {
                    patternDisplay += `▶️ ${colour}`;
                } else {
                    patternDisplay += colour;
                }
                if (index < patternArray.length - 1) {
                    patternDisplay += " → ";
                }
            });

            const colourNames = {
                'G': 'GREEN',
                'R': 'RED', 
                'V': 'VIOLET'
            };

            const patternInfo = `📊 Current Colour Pattern\n\n🎯 Pattern: ${patternDisplay}\n📏 Total Steps: ${patternArray.length}\n🔢 Current Step: ${currentIndex + 1}\n\nNext Bet: ${colourNames[patternArray[currentIndex]] || patternArray[currentIndex]}`;

            await this.bot.sendMessage(chatId, patternInfo);
            
        } catch (error) {
            console.error(`Error viewing Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error viewing Colour pattern. Please try again.");
        }
    }

    async viewSlPattern(chatId, userId) {
        await this.bot.sendMessage(chatId, "View SL Pattern feature will be implemented soon.");
    }

    async showSlStats(chatId, userId) {
        await this.bot.sendMessage(chatId, "SL Stats feature will be implemented soon.");
    }

    async handleSetBetSequence(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            const gameType = userSession.gameType || 'WINGO';
            
            const betSequence = text.trim();
            const amounts = betSequence.split(',').map(x => {
                const num = parseInt(x.trim());
                return isNaN(num) ? null : num;
            }).filter(x => x !== null);
            
            if (amounts.length === 0) {
                await this.bot.sendMessage(chatId, "❌ Invalid bet sequence format!\n\nPlease enter valid numbers separated by commas.\nExample: 100,300,700,1600,3200,7600,16000,32000");
                return;
            }
            
            if (amounts.some(amount => amount <= 0)) {
                await this.bot.sendMessage(chatId, "❌ Invalid bet amounts!\n\nAll bet amounts must be positive numbers.");
                return;
            }
            
            let validationMessage = "";
            if (gameType === 'WINGO_3MIN') {
                const recommendedAmounts = [100, 500, 1000, 5000];
                validationMessage = `\n\n✅ WINGO 3MIN Recommended: ${recommendedAmounts.join(', ')}`;
            } else if (gameType === 'TRX') {
                const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                validationMessage = `\n\n✅ TRX Recommended: ${recommendedAmounts.join(', ')}`;
            } else {
                const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                validationMessage = `\n\n✅ WINGO Recommended: ${recommendedAmounts.join(', ')}`;
            }
            
            await this.saveUserSetting(userId, 'bet_sequence', betSequence);
            await this.saveUserSetting(userId, 'current_bet_index', 0);
            
            const currentAmount = amounts[0];
            
            const successMessage = `✅ Bet Sequence Updated!\n\n🎯 New Sequence: ${betSequence}\n💰 Current Bet: ${currentAmount.toLocaleString()} K (Step 1)\n🎮 Game Type: ${gameType}${validationMessage}\n\n🤖 Bot will now use this sequence for auto betting.`;
            
            await this.bot.sendMessage(chatId, successMessage, {
                reply_markup: this.getBotSettingsKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting bet sequence for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting bet sequence.\n\nPlease try again with valid format:\nExample: 100,300,700,1600,3200,7600,16000,32000");
        }
    }

    async handleSetProfitTarget(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            
            const profitTarget = parseInt(text.trim());
            
            if (isNaN(profitTarget) || profitTarget < 0) {
                await this.bot.sendMessage(chatId, "❌ Invalid profit target!\n\nPlease enter a valid positive number.\nEnter 0 to disable profit target.");
                return;
            }
            
            await this.saveUserSetting(userId, 'profit_target', profitTarget);
            
            let message;
            if (profitTarget === 0) {
                message = "✅ Profit Target Disabled!\n\n🤖 Bot will no longer stop automatically when reaching profit target.";
            } else {
                message = `✅ Profit Target Set!\n\n🎯 Target: ${profitTarget.toLocaleString()} K\n\n🤖 Bot will automatically stop when profit reaches ${profitTarget.toLocaleString()} K.`;
            }
            
            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getBotSettingsKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting profit target for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting profit target.\n\nPlease try again.");
        }
    }

    async handleSetLossTarget(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            
            const lossTarget = parseInt(text.trim());
            
            if (isNaN(lossTarget) || lossTarget < 0) {
                await this.bot.sendMessage(chatId, "❌ Invalid loss target!\n\nPlease enter a valid positive number.\nEnter 0 to disable loss target.");
                return;
            }
            
            await this.saveUserSetting(userId, 'loss_target', lossTarget);
            
            let message;
            if (lossTarget === 0) {
                message = "✅ Loss Target Disabled!\n\n🤖 Bot will no longer stop automatically when reaching loss target.";
            } else {
                message = `✅ Loss Target Set!\n\n🛑 Target: ${lossTarget.toLocaleString()} K\n\n🤖 Bot will automatically stop when loss reaches ${lossTarget.toLocaleString()} K.`;
            }
            
            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getBotSettingsKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting loss target for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting loss target.\n\nPlease try again.");
        }
    }

    async handleSetBsPattern(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            
            const pattern = text.trim().toUpperCase();
            const validPattern = /^[BS,]+$/.test(pattern);
            
            if (!validPattern || pattern.length === 0) {
                await this.bot.sendMessage(chatId, "❌ Invalid BS Pattern!\n\nPlease use ONLY:\n- B for BIG\n- S for SMALL\n- Comma (,) to separate\n\nExamples:\n• B,S,B,B\n• S,S,B\n• B,B,B,S");
                return;
            }

            const patternArray = pattern.split(',').map(p => p.trim()).filter(p => p === 'B' || p === 'S');
            
            if (patternArray.length === 0) {
                await this.bot.sendMessage(chatId, "❌ Invalid BS Pattern!\n\nPattern must contain at least one B or S.");
                return;
            }

            const cleanPattern = patternArray.join(',');

            await this.saveBsPattern(userId, cleanPattern);
            
            await this.saveUserSetting(userId, 'random_betting', 'bs_formula');

            const successMessage = `✅ BS Pattern Set Successfully!\n\n🎯 Pattern: ${cleanPattern}\n📊 Length: ${patternArray.length} steps\n🔢 Current Index: 1\n\n🤖 Bot will now use BS Formula pattern for auto betting.`;

            await this.bot.sendMessage(chatId, successMessage, {
                reply_markup: this.getBsPatternKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting BS pattern.\n\nPlease try again.");
        }
    }

    async saveBsPattern(userId, pattern) {
        try {
            const existing = await this.db.get('SELECT user_id FROM formula_patterns WHERE user_id = ?', [userId]);
            
            if (existing) {
                await this.db.run(
                    'UPDATE formula_patterns SET bs_pattern = ?, bs_current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [pattern, userId]
                );
            } else {
                await this.db.run(
                    'INSERT INTO formula_patterns (user_id, bs_pattern, bs_current_index) VALUES (?, ?, 0)',
                    [userId, pattern]
                );
            }
            return true;
        } catch (error) {
            console.error(`Error saving BS pattern for user ${userId}:`, error);
            return false;
        }
    }

    async handleSetColourPattern(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            
            const pattern = text.trim().toUpperCase();
            const validPattern = /^[GRV,]+$/.test(pattern);
            
            if (!validPattern || pattern.length === 0) {
                await this.bot.sendMessage(chatId, "❌ Invalid Colour Pattern!\n\nPlease use ONLY:\n- G for GREEN\n- R for RED\n- V for VIOLET\n- Comma (,) to separate\n\nExamples:\n• R,G,V,R\n• G,V,R\n• R,R,G");
                return;
            }

            const patternArray = pattern.split(',').map(p => p.trim()).filter(p => p === 'G' || p === 'R' || p === 'V');
            
            if (patternArray.length === 0) {
                await this.bot.sendMessage(chatId, "❌ Invalid Colour Pattern!\n\nPattern must contain at least one G, R or V.");
                return;
            }

            const cleanPattern = patternArray.join(',');

            await this.saveColourPattern(userId, cleanPattern);
            
            await this.saveUserSetting(userId, 'random_betting', 'colour_formula');

            const successMessage = `✅ Colour Pattern Set Successfully!\n\n🎯 Pattern: ${cleanPattern}\n📊 Length: ${patternArray.length} steps\n🔢 Current Index: 1\n\n🤖 Bot will now use Colour Formula pattern for auto betting.`;

            await this.bot.sendMessage(chatId, successMessage, {
                reply_markup: this.getColourPatternKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error setting Colour pattern.\n\nPlease try again.");
        }
    }

    async saveColourPattern(userId, pattern) {
        try {
            const existing = await this.db.get('SELECT user_id FROM formula_patterns WHERE user_id = ?', [userId]);
            
            if (existing) {
                await this.db.run(
                    'UPDATE formula_patterns SET colour_pattern = ?, colour_current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [pattern, userId]
                );
            } else {
                await this.db.run(
                    'INSERT INTO formula_patterns (user_id, colour_pattern, colour_current_index) VALUES (?, ?, 0)',
                    [userId, pattern]
                );
            }
            return true;
        } catch (error) {
            console.error(`Error saving Colour pattern for user ${userId}:`, error);
            return false;
        }
    }

    async handleSetSlPattern(chatId, userId, text) {
        await this.bot.sendMessage(chatId, "Set SL pattern feature will be implemented soon.", {
            reply_markup: this.getMainKeyboard()
        });
    }

    async resetSlPattern(chatId, userId) {
        await this.bot.sendMessage(chatId, "Reset SL pattern feature will be implemented soon.");
    }

    async clearBsPattern(chatId, userId) {
        try {
            await this.clearFormulaPatterns(userId, 'bs');
            await this.saveUserSetting(userId, 'random_betting', 'bot');
            
            await this.bot.sendMessage(chatId, "✅ BS Pattern Cleared!\n\nBS Formula mode has been disabled. Bot will return to Random Bot mode.", {
                reply_markup: this.getBsPatternKeyboard()
            });
            
        } catch (error) {
            console.error(`Error clearing BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error clearing BS pattern. Please try again.");
        }
    }

    async clearColourPattern(chatId, userId) {
        try {
            await this.clearFormulaPatterns(userId, 'colour');
            await this.saveUserSetting(userId, 'random_betting', 'bot');
            
            await this.bot.sendMessage(chatId, "✅ Colour Pattern Cleared!\n\nColour Formula mode has been disabled. Bot will return to Random Bot mode.", {
                reply_markup: this.getColourPatternKeyboard()
            });
            
        } catch (error) {
            console.error(`Error clearing Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "❌ Error clearing Colour pattern. Please try again.");
        }
    }

    async handleAddGameId(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const gameIdsInput = match[1];
        const gameIds = gameIdsInput.split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id));
        
        if (gameIds.length === 0) {
            await this.bot.sendMessage(chatId, "Invalid format! Use: /aid game_id1,game_id2\nExample: /aid 102310,864480");
            return;
        }

        try {
            for (const gameId of gameIds) {
                await this.db.run(
                    'INSERT OR REPLACE INTO allowed_game_ids (game_id, added_by) VALUES (?, ?)',
                    [gameId, userId]
                );
            }
            
            await this.bot.sendMessage(chatId, `Game IDs added successfully!\n\nAdded: ${gameIds.join(', ')}\nTotal: ${gameIds.length} game IDs`);
            
        } catch (error) {
            console.error(`Error adding game IDs:`, error);
            await this.bot.sendMessage(chatId, "Failed to add game IDs. Please try again.");
        }
    }

    async handleRemoveGameId(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const gameId = match[1];
        try {
            await this.db.run('DELETE FROM allowed_game_ids WHERE game_id = ?', [gameId]);
            await this.bot.sendMessage(chatId, `Game ID '${gameId}' removed successfully!`);
        } catch (error) {
            console.error(`Error removing game ID ${gameId}:`, error);
            await this.bot.sendMessage(chatId, "Failed to remove game ID.");
        }
    }

    async handleListGameIds(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        try {
            const gameIds = await this.getAllowedGameIds();
            if (gameIds.length === 0) {
                await this.bot.sendMessage(chatId, "No game IDs found.");
                return;
            }

            let gameIdsText = "Allowed Game IDs:\n\n";
            gameIds.forEach((gameId, i) => {
                gameIdsText += `${i+1}. ${gameId}\n`;
            });

            gameIdsText += `\nTotal: ${gameIds.length} game IDs\n`;
            await this.bot.sendMessage(chatId, gameIdsText);
        } catch (error) {
            console.error(`Error listing game IDs:`, error);
            await this.bot.sendMessage(chatId, "Error getting game IDs.");
        }
    }

    async handleGameIdStats(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        try {
            const gameIds = await this.getAllowedGameIds();
            const totalIds = gameIds.length;

            let statsText = `Game ID Statistics\n\nTotal Allowed Game IDs: ${totalIds}\n\nRecent Game IDs:\n`;

            const recentIds = gameIds.slice(0, 10);
            recentIds.forEach((gameId, i) => {
                statsText += `${i+1}. ${gameId}\n`;
            });

            if (totalIds > 10) {
                statsText += `\n... and ${totalIds - 10} more`;
            }

            statsText += `\n\nLast Updated: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, statsText);
        } catch (error) {
            console.error(`Error getting game ID stats:`, error);
            await this.bot.sendMessage(chatId, "Error getting game ID statistics.");
        }
    }

    async handleBroadcastMessage(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        await this.bot.sendMessage(chatId, "Broadcast feature will be implemented soon.");
    }

    async handleBroadcastActive(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        await this.bot.sendMessage(chatId, "Active broadcast feature will be implemented soon.");
    }
}

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
console.log("Bet Sequence System: WINGO 3MIN: 100,500,1000,5000 | TRX/WINGO: 100,300,700,1600,3200,7600,16000,32000");
console.log("Profit/Loss Target System");
console.log("Auto Statistics Tracking");
console.log("Colour Betting Support (RED, GREEN, VIOLET)");
console.log("TRX Game Support: ENABLED");
console.log("Win/Loss Messages: ENABLED");
console.log("Supported Platforms: 777 Big Win (WINGO & TRX)");
console.log("Myanmar Time System: ENABLED");
console.log("Press Ctrl+C to stop.");

const bot = new AutoLotteryBot();

process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    process.exit();
});
