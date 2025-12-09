const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const crypto = require('crypto');

// BOT CONFIGURATION
const BOT_TOKEN = "8308226058:AAEiPBihhrgllH18VneeflOS0jVgNqSKLUE";
const CHANNEL_USERNAME = "@Vipsafesingalchannel298";
const CHANNEL_LINK = "https://t.me/Vipsafesingalchannel298";
const ADMIN_USER_ID = "6328953001";

// API ENDPOINTS
const API_ENDPOINTS = {
    "777": "https://api.bigwinqaz.com/api/webapi/",
    "TRX": "https://api.bigwinqaz.com/api/webapi/"
};

// COLOUR BET TYPES
const COLOUR_BET_TYPES = {
    "RED": 10,
    "GREEN": 11, 
    "VIOLET": 12
};

// TRX BET TYPES
const TRX_BET_TYPES = {
    "BIG": 13,
    "SMALL": 14
};

// DATABASE SETUP
const DB_NAME = "auto_bot.db";

// GLOBAL STORAGE
const userSessions = {};
const issueCheckers = {};
const autoBettingTasks = {};
const waitingForResults = {};
const processedIssues = {};

// MYANMAR TIME FUNCTION
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
                endpoint = 'GetTRXGameIssue'; // Changed to GetTRXGameIssue
            } else if (this.gameType === 'TRX_3MIN') {
                typeId = 14;
                endpoint = 'GetTRXGameIssue'; // Changed to GetTRXGameIssue
            } else if (this.gameType === 'TRX_5MIN') {
                typeId = 15;
                endpoint = 'GetTRXGameIssue'; // Changed to GetTRXGameIssue
            } else if (this.gameType === 'TRX_10MIN') {
                typeId = 16;
                endpoint = 'GetTRXGameIssue'; // Changed to GetTRXGameIssue
            } else if (this.gameType === 'WINGO_30S') {
                typeId = 30;
                endpoint = 'GetGameIssue';
            } else if (this.gameType === 'WINGO_3MIN') {
                typeId = 2;
                endpoint = 'GetGameIssue';
            } else if (this.gameType === 'WINGO_5MIN') {
                typeId = 3;
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

            console.log(`GETTING CURRENT ISSUE FOR ${this.gameType}, TYPEID: ${typeId}, ENDPOINT: ${endpoint}`);

            const response = await axios.post(`${this.baseUrl}${endpoint}`, body, {
                headers: this.headers,
                timeout: 10000
            });

            console.log(`ISSUE RESPONSE FOR ${this.gameType}:`, JSON.stringify(response.data));

            if (response.status === 200) {
                const result = response.data;
                
                if (result.msgCode === 0) {
                    let issueNumber = '';
                    
                    // TRX GAMES - using new TRX endpoints
                    if (this.gameType === 'TRX' || this.gameType === 'TRX_3MIN' || 
                        this.gameType === 'TRX_5MIN' || this.gameType === 'TRX_10MIN') {
                        issueNumber = result.data?.predraw?.issueNumber || 
                                     result.data?.issueNumber || 
                                     result.issueNumber || 
                                     result.data?.currentIssue || '';
                    } 
                    // WINGO 30S GAME
                    else if (this.gameType === 'WINGO_30S') {
                        if (result.data) {
                            issueNumber = result.data.issueNumber || 
                                         result.data.predraw?.issueNumber || 
                                         result.data.current?.issueNumber || '';
                            
                            if (!issueNumber) {
                                if (result.data.currentIssue) {
                                    issueNumber = result.data.currentIssue;
                                } else if (result.data.issue) {
                                    issueNumber = result.data.issue;
                                }
                            }
                        }
                        
                        if (!issueNumber) {
                            issueNumber = result.issueNumber || result.issue || '';
                        }
                    }
                    // OTHER WINGO GAMES
                    else {
                        issueNumber = result.data?.issueNumber || 
                                     result.data?.predraw?.issueNumber || 
                                     result.issueNumber || 
                                     result.data?.current?.issueNumber || '';
                        
                        if (!issueNumber && result.data) {
                            const dataStr = JSON.stringify(result.data);
                            const issueMatch = dataStr.match(/"issueNumber"\s*:\s*"(\d+)"/);
                            if (issueMatch) {
                                issueNumber = issueMatch[1];
                            }
                        }
                    }
                    
                    console.log(`CURRENT ISSUE FOR ${this.gameType}: ${issueNumber}`);
                    return issueNumber;
                } else {
                    console.log(`ERROR GETTING ISSUE FOR ${this.gameType}:`, result.msg);
                    return "";
                }
            } else {
                console.log(`HTTP ERROR FOR ${this.gameType}:`, response.status);
                return "";
            }
        } catch (error) {
            console.error(`ERROR GETTING CURRENT ISSUE FOR ${this.gameType}:`, error.message);
            
            if (error.response) {
                console.error('Error response data:', error.response.data);
                console.error('Error response status:', error.response.status);
                console.error('Error response headers:', error.response.headers);
            } else if (error.request) {
                console.error('No response received:', error.request);
            } else {
                console.error('Error setting up request:', error.message);
            }
            
            return "";
        }
    }

    async placeBet(amount, betType) {
        try {
            console.log(`ATTEMPTING TO PLACE BET - GAME: ${this.gameType}, AMOUNT: ${amount}, BETTYPE: ${betType}`);
            
            let issueId = "";
            let retryCount = 0;
            const maxRetries = 3;
            
            while (!issueId && retryCount < maxRetries) {
                issueId = await this.getCurrentIssue();
                if (!issueId) {
                    console.log(`Failed to get issue (attempt ${retryCount + 1}/${maxRetries})`);
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            if (!issueId) {
                console.log(`FAILED TO GET ISSUE AFTER ${maxRetries} ATTEMPTS`);
                return { 
                    success: false, 
                    message: "Failed to get current issue after multiple attempts. Please check your game type and try again.", 
                    issueId: "", 
                    potentialProfit: 0 
                };
            }

            console.log(`SUCCESSFULLY GOT ISSUE: ${issueId} FOR ${this.gameType}`);
            console.log(`PLACING BET - ISSUE: ${issueId}, AMOUNT: ${amount}, BETTYPE: ${betType}, GAMETYPE: ${this.gameType}, PLATFORM: ${this.platform}`);

            let requestBody;
            
            const baseAmount = amount < 10000 ? 10 : Math.pow(10, amount.toString().length - 2);
            const betCount = Math.floor(amount / baseAmount);
            const isColourBet = [10, 11, 12].includes(betType);
            
            let typeId, gameType;
            
            if (this.gameType === 'TRX') {
                typeId = 13;
                gameType = 2;
            } else if (this.gameType === 'TRX_3MIN') {
                typeId = 14;
                gameType = 2;
            } else if (this.gameType === 'TRX_5MIN') {
                typeId = 15;
                gameType = 2;
            } else if (this.gameType === 'TRX_10MIN') {
                typeId = 16;
                gameType = 2;
            } else if (this.gameType === 'WINGO_30S') {
                typeId = 30;
                gameType = isColourBet ? 0 : 2;
            } else if (this.gameType === 'WINGO_3MIN') {
                typeId = 2;
                gameType = isColourBet ? 0 : 2;
            } else if (this.gameType === 'WINGO_5MIN') {
                typeId = 3;
                gameType = isColourBet ? 0 : 2;
            } else {
                typeId = 1;
                gameType = isColourBet ? 0 : 2;
            }

            console.log(`BET PARAMS - TYPEID: ${typeId}, GAMETYPE: ${gameType}, ISCOLOURBET: ${isColourBet}`);

            requestBody = {
                "typeId": typeId,
                "issuenumber": issueId,
                "language": 0,
                "gameType": gameType,
                "amount": baseAmount,
                "betCount": betCount,
                "selectType": betType,
                "random": this.randomKey(),
                "timestamp": Math.floor(Date.now() / 1000)
            };

            console.log(`777 PLATFORM CALCULATION - AMOUNT: ${amount}, BASEAMOUNT: ${baseAmount}, BETCOUNT: ${betCount}, TOTAL: ${baseAmount * betCount}`);

            requestBody.signature = this.signMd5(requestBody);

            console.log('REQUEST BODY:', JSON.stringify(requestBody, null, 2));

            let endpoint;
            if (this.gameType === 'TRX' || this.gameType === 'TRX_3MIN' || 
                this.gameType === 'TRX_5MIN' || this.gameType === 'TRX_10MIN') {
                endpoint = 'GameTrxBetting';
            } else {
                endpoint = 'GameBetting';
            }

            console.log(`CALLING ENDPOINT: ${this.baseUrl}${endpoint}`);

            const response = await axios.post(`${this.baseUrl}${endpoint}`, requestBody, {
                headers: this.headers,
                timeout: 15000
            });

            console.log('API RESPONSE:', JSON.stringify(response.data, null, 2));

            if (response.status === 200) {
                const result = response.data;
                
                if (result.code === 0 || result.msgCode === 0 || result.success === true) {
                    let potentialProfit;
                    
                    if (betType === 10) {
                        const contractAmount = Math.floor(amount * 0.98);
                        potentialProfit = contractAmount * 2;
                    } else if (betType === 11) {
                        const contractAmount = Math.floor(amount * 0.98);
                        potentialProfit = contractAmount * 2;
                    } else if (betType === 12) {
                        const contractAmount = Math.floor(amount * 0.98);
                        potentialProfit = contractAmount * 2;
                    } else {
                        potentialProfit = Math.floor(amount * 0.96);
                    }
                    
                    return { 
                        success: true, 
                        message: "Bet placed successfully", 
                        issueId, 
                        potentialProfit, 
                        actualAmount: amount,
                        contractAmount: Math.floor(amount * 0.98)
                    };
                } else {
                    const errorMsg = result.msg || result.message || result.error || 'Bet failed';
                    console.log('BET API ERROR:', errorMsg);
                    
                    if (errorMsg.includes('balance') || errorMsg.includes('amount')) {
                        return { 
                            success: false, 
                            message: "Insufficient balance or amount error", 
                            issueId, 
                            potentialProfit: 0 
                        };
                    } else if (errorMsg.includes('issue')) {
                        return { 
                            success: false, 
                            message: "Issue has already closed", 
                            issueId, 
                            potentialProfit: 0 
                        };
                    } else {
                        return { 
                            success: false, 
                            message: errorMsg, 
                            issueId, 
                            potentialProfit: 0 
                        };
                    }
                }
            } else {
                console.log('HTTP ERROR:', response.status, response.statusText);
                return { 
                    success: false, 
                    message: `API connection failed: ${response.status}`, 
                    issueId, 
                    potentialProfit: 0 
                };
            }
        } catch (error) {
            console.log('BETTING ERROR:', error.message);
            
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                return { 
                    success: false, 
                    message: "Connection timeout or server error. Please try again.", 
                    issueId: "", 
                    potentialProfit: 0 
                };
            } else if (error.response) {
                return { 
                    success: false, 
                    message: `API error: ${error.response.status}`, 
                    issueId: "", 
                    potentialProfit: 0 
                };
            } else {
                return { 
                    success: false, 
                    message: `Betting error: ${error.message}`, 
                    issueId: "", 
                    potentialProfit: 0 
                };
            }
        }
    }

    async getRecentResults(count = 10) {
        try {
            // TRX GAMES - using new TRX endpoint
            if (this.gameType === 'TRX' || this.gameType === 'TRX_3MIN' || 
                this.gameType === 'TRX_5MIN' || this.gameType === 'TRX_10MIN') {
                
                let typeId;
                if (this.gameType === 'TRX') {
                    typeId = 13;
                } else if (this.gameType === 'TRX_3MIN') {
                    typeId = 14;
                } else if (this.gameType === 'TRX_5MIN') {
                    typeId = 15;
                } else if (this.gameType === 'TRX_10MIN') {
                    typeId = 16;
                }

                const body = {
                    "typeId": typeId,
                    "pageNo": 1,
                    "pageSize": count,
                    "language": 0,
                    "random": "b05034ba4a2642009350ee863f29e2e9",
                    "timestamp": Math.floor(Date.now() / 1000)
                };
                body.signature = this.signMd5(body);

                // Using GetTRXNoaverageEmerdList for TRX results
                const response = await axios.post(`${this.baseUrl}GetTRXNoaverageEmerdList`, body, {
                    headers: this.headers,
                    timeout: 10000
                });

                console.log(`TRX RESULTS RESPONSE FOR ${this.gameType}:`, JSON.stringify(response.data));

                if (response.status === 200) {
                    const result = response.data;
                    if (result.msgCode === 0) {
                        const dataStr = JSON.stringify(response.data);
                        const startIdx = dataStr.indexOf('[');
                        const endIdx = dataStr.indexOf(']') + 1;
                        
                        if (startIdx !== -1 && endIdx !== -1) {
                            const resultsJson = dataStr.substring(startIdx, endIdx);
                            const results = JSON.parse(resultsJson);
                            
                            const formattedResults = results.map(resultItem => {
                                const issueNumber = resultItem.issueNumber || resultItem.issue || '';
                                const number = String(resultItem.number || resultItem.openNumber || '');
                                
                                let colour = 'UNKNOWN';
                                if (['0', '5'].includes(number)) {
                                    colour = 'VIOLET';
                                } else if (['1', '3', '7', '9'].includes(number)) {
                                    colour = 'GREEN';
                                } else if (['2', '4', '6', '8'].includes(number)) {
                                    colour = 'RED';
                                }
                                
                                return {
                                    issueNumber: issueNumber,
                                    number: number,
                                    colour: colour
                                };
                            });
                            
                            return formattedResults;
                        } else {
                            // Try alternative format for TRX
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
                }
            } else {
                // WINGO GAMES (existing code)
                let typeId;
                if (this.gameType === 'WINGO_30S') {
                    typeId = 30;
                } else if (this.gameType === 'WINGO_3MIN') {
                    typeId = 2;
                } else if (this.gameType === 'WINGO_5MIN') {
                    typeId = 3;
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
            console.error(`Error getting recent results for ${this.gameType}:`, error.message);
            return [];
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
        
        if (userSession && (userSession.gameType === 'TRX' || userSession.gameType === 'TRX_3MIN' ||
            userSession.gameType === 'TRX_5MIN' || userSession.gameType === 'TRX_10MIN')) {
            return {
                keyboard: [
                    [{ text: "Login" }],
                    [{ text: "Balance" }, { text: "Results" }],
                    [{ text: "Bet BIG" }, { text: "Bet SMALL" }],
                    [{ text: "Bot Settings" }, { text: "My Bets" }],
                    [{ text: "Bot Info" }, { text: "WINGO/TRX" }],
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
                    [{ text: "Bot Info" }, { text: "WINGO/TRX" }],
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
                [{ text: "Set Bet Sequence" }],
                [{ text: "Profit Target" }, { text: "Loss Target" }],
                [{ text: "Main Menu" }]
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
                [{ text: "WINGO 30S" }],
                [{ text: "WINGO 3 MIN" }],
                [{ text: "WINGO 5 MIN" }],
                [{ text: "TRX 3 MIN" }],
                [{ text: "TRX 5 MIN" }],
                [{ text: "TRX 10 MIN" }],
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

        const welcomeText = `Welcome ${msg.from.first_name}!

Auto Bot Features:
- Random BIG Betting
- Random SMALL Betting  
- Random BIG/SMALL Betting
- Follow Bot (Follow Last Result)
- BS Formula Pattern Betting (B,S only)
- Colour Formula Pattern Betting (G,R,V only)
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
- WINGO 30S/3MIN/5MIN Switching
- TRX 3 MIN/5 MIN/10 MIN Support

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

                case "TRX 3 MIN":
                case "TRX 5 MIN":
                case "TRX 10 MIN":
                case "WINGO 30S":
                case "WINGO 3 MIN":
                case "WINGO 5 MIN":
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
            gameTypeInfo = "\n\nTRX Game: Supports BIG/SMALL Only (No colour betting)";
        } else if (currentGameType === 'TRX_3MIN') {
            gameTypeInfo = "\n\nTRX 3 MIN: Supports BIG/SMALL Only (No colour betting)";
        } else if (currentGameType === 'TRX_5MIN') {
            gameTypeInfo = "\n\nTRX 5 MIN: Supports BIG/SMALL Only (No colour betting)";
        } else if (currentGameType === 'TRX_10MIN') {
            gameTypeInfo = "\n\nTRX 10 MIN: Supports BIG/SMALL Only (No colour betting)";
        } else if (currentGameType === 'WINGO_30S') {
            gameTypeInfo = "\n\nWINGO 30S: Supports Bot BIG/SMALL and Colour betting";
        } else if (currentGameType === 'WINGO_3MIN') {
            gameTypeInfo = "\n\nWINGO 3 MIN: Supports Bot BIG/SMALL and Colour betting";
        } else if (currentGameType === 'WINGO_5MIN') {
            gameTypeInfo = "\n\nWINGO 5 MIN: Supports Bot BIG/SMALL and Colour betting";
        } else {
            gameTypeInfo = "\n\nWINGO: Supports Bot BIG/SMALL and Colour betting";
        }
        
        const gameTypeText = `Current Game Type: ${currentGameType}${gameTypeInfo}

Select Game Type:
• WINGO: (BIG/SMALL + Colours) Support
• TRX: (BIG/SMALL) Support
• TRX 3 MIN: (BIG/SMALL) Support
• TRX 5 MIN: (BIG/SMALL) Support
• TRX 10 MIN: (BIG/SMALL) Support
• WINGO 30S: (BIG/SMALL + Colours) Support 
• WINGO 3 MIN: (BIG/SMALL + Colours) Support
• WINGO 5 MIN: (BIG/SMALL + Colours) Support

Choose your game type:`;

        await this.bot.sendMessage(chatId, gameTypeText, {
            reply_markup: this.getGameTypeKeyboard()
        });
    }

    async handleSetGameType(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            let gameType = text.toUpperCase();
            
            if (text === "WINGO 30S") {
                gameType = "WINGO_30S";
            } else if (text === "WINGO 3 MIN") {
                gameType = "WINGO_3MIN";
            } else if (text === "WINGO 5 MIN") {
                gameType = "WINGO_5MIN";
            } else if (text === "TRX 3 MIN") {
                gameType = "TRX_3MIN";
            } else if (text === "TRX 5 MIN") {
                gameType = "TRX_5MIN";
            } else if (text === "TRX 10 MIN") {
                gameType = "TRX_10MIN";
            }
            
            if (gameType === 'WINGO' || gameType === 'TRX' || gameType === 'WINGO_30S' || 
                gameType === 'WINGO_3MIN' || gameType === 'WINGO_5MIN' || gameType === 'TRX_3MIN' ||
                gameType === 'TRX_5MIN' || gameType === 'TRX_10MIN') {
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
                await this.bot.sendMessage(chatId, "Invalid game type. Please select from available options.", {
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

            const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${betTypeStr} Bet`);

            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const betText = `Bet Placed Successfully!\n\nIssue: ${result.issueId}\nType: ${betTypeStr}\nAmount: ${amount.toLocaleString()} K`;

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
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        try {
            if (userSession.gameType === 'TRX' || userSession.gameType === 'TRX_3MIN' ||
                userSession.gameType === 'TRX_5MIN' || userSession.gameType === 'TRX_10MIN') {
                await this.bot.sendMessage(chatId, `${userSession.gameType} Game Notice\n\n${userSession.gameType} game does not support colour betting.\n\nPlease use:\n• Bet BIG\n• Bet SMALL\n\nOr switch to WINGO/WINGO 30S/WINGO 3 MIN for colour betting.`);
                return;
            }

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
            const betType = COLOUR_BET_TYPES[colour];
            const gameType = userSession.gameType || 'WINGO';

            const balance = await userSession.apiInstance.getBalance();
            if (balance < amount) {
                await this.bot.sendMessage(chatId, `Insufficient balance!\n\nYou have: ${balance.toLocaleString()} K\nNeed: ${amount.toLocaleString()} K`);
                return;
            }

            const contractAmount = Math.floor(amount * 0.98);
            let potentialProfit, payoutInfo;
            
            if (colour === "RED") {
                potentialProfit = contractAmount * 2;
                payoutInfo = "Win 2x on 2,4,6,8 | Win 1.5x on 0";
            } else if (colour === "GREEN") {
                potentialProfit = contractAmount * 2;
                payoutInfo = "Win 2x on 1,3,7,9 | Win 1.5x on 5";
            } else if (colour === "VIOLET") {
                potentialProfit = contractAmount * 2;
                payoutInfo = "Win 2x on 0,5";
            }

            const platformName = '777 Big Win';

            const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${colour} Bet`);

            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                const betTypeStr = `${colour}`;
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const betText = `Colour Bet Placed Successfully!\n\n• Issue: ${result.issueId}\n• Type: ${colour}\n• Amount: ${amount.toLocaleString()} K`;

                await this.bot.editMessageText(betText, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                await this.bot.editMessageText(`${colour} Bet Failed\n\nError: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            console.error(`Colour bet error for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, `${colour} Bet Error\n\nError: ${error.message}`);
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
                    balanceText = `\nCurrent Balance: ${currentBalance.toLocaleString()} K`;
                } catch (balanceError) {
                    console.error(`Error getting balance for user ${userId}:`, balanceError);
                    balanceText = "\nCurrent Balance: Unable to check balance";
                }
            }
            
            const stopMessage = `Bot Stopped!`;
            console.log(`Sending stop message to user ${userId}`);
            
            await this.bot.sendMessage(chatId, stopMessage, {
                reply_markup: this.getMainKeyboard()
            });
            
            console.log(`Bot successfully stopped for user ${userId}`);
            
        } catch (error) {
            console.error(`Error in stopBot for user ${userId}:`, error);
            
            try {
                await this.bot.sendMessage(chatId, "Bot stopped with some issues.\n\nPlease check if bot is still running.", {
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
            console.log(`Checking bet result for user ${userId}, issue: ${issue}`);

            const userSession = userSessions[userId];
            if (!userSession || !userSession.apiInstance) {
                console.log(`No user session or API instance for user ${userId}`);
                return;
            }

            const platform = userSession.platform || '777';
            const gameType = userSession.gameType || 'WINGO';
            
            const pendingBet = await this.db.get(
                'SELECT platform, issue, bet_type, amount FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                [userId, platform, issue]
            );

            if (!pendingBet) {
                console.log(`No pending bet found for user ${userId}, issue ${issue}`);
                return;
            }

            console.log(`Found pending bet: ${JSON.stringify(pendingBet)}`);

            const betTypeStr = pendingBet.bet_type;
            const amount = pendingBet.amount;
            const contractAmount = Math.floor(amount * 0.98);

            const results = await userSession.apiInstance.getRecentResults(20);
            console.log(`Retrieved ${results.length} recent results for user ${userId}`);

            if (results.length === 0) {
                console.log(`No results found for user ${userId}`);
                return;
            }

            let betResult = "UNKNOWN";
            let profitLoss = 0;
            let resultNumber = "";
            let resultType = "";
            let resultColour = "";

            let resultFound = false;
            for (const result of results) {
                console.log(`Checking result: ${result.issueNumber} vs ${issue}`);
                
                if (result.issueNumber === issue) {
                    resultFound = true;
                    resultNumber = result.number || 'N/A';
                    console.log(`Found matching result for issue ${issue}: number ${resultNumber}`);
                    
                    if (gameType === 'TRX' || gameType === 'TRX_3MIN' ||
                        gameType === 'TRX_5MIN' || gameType === 'TRX_10MIN') {
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
                    } else {
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

                    console.log(`Result analysis - Type: ${resultType}, Colour: ${resultColour}`);

                    if (betTypeStr.includes("BIG")) {
                        if (resultType === "BIG") {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 0.96);
                            console.log(`BIG bet WON`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`BIG bet LOST`);
                        }
                    } else if (betTypeStr.includes("SMALL")) {
                        if (resultType === "SMALL") {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 0.96);
                            console.log(`SMALL bet WON`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`SMALL bet LOST`);
                        }
                    } else if (betTypeStr.includes("RED")) {
                        if (['2','4','6','8'].includes(resultNumber)) {
                            betResult = "WIN";
                            profitLoss = contractAmount * 2;
                            console.log(`RED bet WON - 2,4,6,8`);
                        } else if (resultNumber === '0') {
                            betResult = "WIN";
                            profitLoss = Math.floor(contractAmount * 1.5);
                            console.log(`RED bet WON - 0 (1.5x)`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`RED bet LOST`);
                        }
                    } else if (betTypeStr.includes("GREEN")) {
                        if (['1','3','7','9'].includes(resultNumber)) {
                            betResult = "WIN";
                            profitLoss = contractAmount * 2;
                            console.log(`GREEN bet WON - 1,3,7,9`);
                        } else if (resultNumber === '5') {
                            betResult = "WIN";
                            profitLoss = Math.floor(contractAmount * 1.5);
                            console.log(`GREEN bet WON - 5 (1.5x)`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`GREEN bet LOST`);
                        }
                    } else if (betTypeStr.includes("VIOLET")) {
                        if (['0','5'].includes(resultNumber)) {
                            betResult = "WIN";
                            profitLoss = contractAmount * 2;
                            console.log(`VIOLET bet WON - 0,5`);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                            console.log(`VIOLET bet LOST`);
                        }
                    }
                    break;
                }
            }

            if (!resultFound) {
                console.log(`Result not found for issue ${issue} in recent results`);
                return;
            }

            if (betResult === "UNKNOWN") {
                console.log(`Unknown bet result for issue ${issue}`);
                return;
            }

            await this.db.run(
                'INSERT INTO bet_history (user_id, platform, issue, bet_type, amount, result, profit_loss) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, platform, issue, betTypeStr, amount, betResult, profitLoss]
            );
            console.log(`Bet history saved for user ${userId}`);

            await this.db.run(
                'DELETE FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                [userId, platform, issue]
            );
            console.log(`Pending bet removed for user ${userId}`);

            const botSession = await this.getBotSession(userId);
            const totalProfitBefore = botSession.total_profit || 0;
            const newTotalProfit = totalProfitBefore + profitLoss;

            await this.updateBotStats(userId, profitLoss, newTotalProfit);
            console.log(`Bot stats updated for user ${userId}, new total profit: ${newTotalProfit}`);

            console.log(`Calling updateBetSequence for user ${userId} with result: ${betResult}`);
            await this.updateBetSequence(userId, betResult);

            waitingForResults[userId] = false;
            console.log(`Reset waitingForResults for user ${userId}`);

            console.log(`Sending result message to user ${userId}`);
            await this.sendResultMessage(userId, issue, betTypeStr, amount, betResult, profitLoss, resultNumber, resultType, resultColour, newTotalProfit);

            console.log(`Bet result processed for user ${userId}: ${betResult} on issue ${issue}, Profit: ${profitLoss}`);
            
        } catch (error) {
            console.error(`Error checking single bet result for user ${userId}, issue ${issue}:`, error);
            waitingForResults[userId] = false;
        }
    }

    async sendResultMessage(userId, issue, betTypeStr, amount, betResult, profitLoss, resultNumber, resultType, resultColour, totalProfit = 0) {
        try {
            const userSession = userSessions[userId];
            if (!userSession) {
                console.log(`No user session for sending message to ${userId}`);
                return;
            }

            const chatId = userId;
            const gameType = userSession.gameType || 'WINGO';

            let message = "";
            
            if (betResult === "WIN") {
                message = `BET SESULT - WIN!\n\n`;
                
                message += `TOTAL PROFIT: ${totalProfit.toLocaleString()} K\n\n`;
            } else {
                message = `BET RESULT - LOSS\n\n`;
                
                message += `TOTAL PROFIT: ${totalProfit.toLocaleString()} K\n\n`;
            }

            message += ` \n`;
            message += ` \n`;
            message += ` \n`;
            message += ` \n`;
            message += ` \n`;
            message += ` \n\n`;

            if (userSession.loggedIn && userSession.apiInstance) {
                try {
                    const currentBalance = await userSession.apiInstance.getBalance();
                    message += ` \n\n`;
                    console.log(`Balance retrieved: ${currentBalance} for user ${userId}`);
                } catch (balanceError) {
                    console.error(`Error getting balance for result message:`, balanceError);
                    message += `Current Balance: Unable to check balance\n\n`;
                }
            }

            message += ` `;

            console.log(`Sending message to user ${userId}: ${message.substring(0, 100)}...`);
            
            await this.bot.sendMessage(chatId, message, { 
                disable_notification: false
            });
            
            console.log(`Result message sent successfully to user ${userId}`);

        } catch (error) {
            console.error(`Error sending result message to user ${userId}:`, error);
            
            try {
                const simpleMessage = betResult === "WIN" ? 
                    `WIN! ${betTypeStr} bet on issue ${issue}. Profit: +${profitLoss}K | Total: ${totalProfit}K` :
                    `LOSE! ${betTypeStr} bet on issue ${issue}. Loss: -${amount}K | Total: ${totalProfit}K`;
                    
                await this.bot.sendMessage(userId, simpleMessage);
                console.log(`Simple message sent as fallback to user ${userId}`);
            } catch (fallbackError) {
                console.error(`Even simple message failed for user ${userId}:`, fallbackError);
            }
        }
    }

    async updateBetSequence(userId, result) {
        try {
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

            console.log(`Updating bet sequence for user ${userId}: currentIndex=${currentIndex}, result=${result}, sequence=${betSequence}`);

            let newIndex;
            if (result === "WIN") {
                newIndex = 0;
                console.log(`Win - Reset sequence to step 1`);
            } else {
                newIndex = currentIndex + 1;
                
                if (newIndex >= amounts.length) {
                    newIndex = 0;
                    console.log(`Loss - Reached end of sequence, reset to step 1`);
                } else {
                    console.log(`Loss - Move to next step: ${currentIndex} -> ${newIndex}`);
                }
            }

            await this.saveUserSetting(userId, 'current_bet_index', newIndex);
            console.log(`Saved new bet index: ${newIndex} for user ${userId}`);
            
            return newIndex;

        } catch (error) {
            console.error(`Error updating bet sequence for user ${userId}:`, error);
            return 0;
        }
    }

    async updateBotStats(userId, profit = 0, totalProfit = null) {
        try {
            const session = await this.getBotSession(userId);
            const newTotalBets = session.total_bets + 1;
            
            const newTotalProfit = totalProfit !== null ? totalProfit : session.total_profit + profit;
            
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

            const patternsData = await this.getFormulaPatterns(userId);
            
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
                    modeText = `BS Formula (${patternsData.bs_pattern || 'Not set'})`;
                    break;
                case 'colour_formula':
                    modeText = `Colour Formula (${patternsData.colour_pattern || 'Not set'})`;
                    break;
                default:
                    modeText = "Random Bot";
            }

            const startMessage = `Auto Bot Started!`;
            await this.bot.sendMessage(chatId, startMessage);

            this.startAutoBetting(userId);
            
        } catch (error) {
            console.error(`Error running bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error starting bot.\n\nPlease try again.");
        }
    }

    startAutoBetting(userId) {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) {
            console.log(`No user session or API instance for user ${userId}`);
            return;
        }

        let lastIssue = "";
        let consecutiveFailures = 0;
        const maxFailures = 3;

        const bettingLoop = async () => {
            if (!autoBettingTasks[userId]) {
                console.log(`Auto betting stopped for user ${userId}`);
                return;
            }

            try {
                if (waitingForResults[userId]) {
                    console.log(`User ${userId} waiting for results, checking again in 3 seconds`);
                    setTimeout(bettingLoop, 3000);
                    return;
                }

                const currentIssue = await userSession.apiInstance.getCurrentIssue();
                console.log(`Current issue for user ${userId}: ${currentIssue}, last issue: ${lastIssue}`);
                
                if (currentIssue && currentIssue !== lastIssue) {
                    console.log(`New issue detected: ${currentIssue} for user ${userId}`);
                    
                    let delay;
                    if (userSession.gameType === 'WINGO_30S') {
                        delay = 2000;
                    } else if (userSession.gameType === 'WINGO_3MIN') {
                        delay = 5000;
                    } else if (userSession.gameType === 'WINGO_5MIN') {
                        delay = 7000;
                    } else if (userSession.gameType === 'TRX_3MIN') {
                        delay = 5000;
                    } else if (userSession.gameType === 'TRX_5MIN') {
                        delay = 7000;
                    } else if (userSession.gameType === 'TRX_10MIN') {
                        delay = 12000;
                    } else {
                        delay = 3000;
                    }
                    
                    setTimeout(async () => {
                        try {
                            if (!autoBettingTasks[userId]) return;

                            if (!(await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue))) {
                                console.log(`Placing bet for user ${userId} on issue ${currentIssue}`);
                                await this.placeAutoBet(userId, currentIssue);
                                lastIssue = currentIssue;
                                consecutiveFailures = 0;
                            } else {
                                console.log(`User ${userId} already bet on issue ${currentIssue}`);
                            }
                            
                            setTimeout(bettingLoop, 2000);
                        } catch (error) {
                            console.error(`Error in betting timeout for user ${userId}:`, error);
                            setTimeout(bettingLoop, 5000);
                        }
                    }, delay);
                } else {
                    console.log(`Same issue or no issue for user ${userId}, checking again in 3 seconds`);
                    setTimeout(bettingLoop, 3000);
                }
            } catch (error) {
                console.error(`Auto betting error for user ${userId}:`, error);
                consecutiveFailures++;
                
                if (consecutiveFailures >= maxFailures) {
                    console.log(`Too many errors, stopping bot for user ${userId}`);
                    this.bot.sendMessage(userId, "Auto Bot Stopped - Too many errors!").catch(console.error);
                    delete autoBettingTasks[userId];
                    delete waitingForResults[userId];
                    this.saveBotSession(userId, false);
                } else {
                    console.log(`Retrying after error for user ${userId} (${consecutiveFailures}/${maxFailures})`);
                    setTimeout(bettingLoop, 5000);
                }
            }
        };

        console.log(`Starting auto betting loop for user ${userId}`);
        bettingLoop();
    }

    async placeAutoBet(userId, issue) {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.loggedIn) {
            console.log(`User ${userId} not logged in for auto bet`);
            return;
        }

        waitingForResults[userId] = true;

        const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
        
        let betType, betTypeStr;

        console.log(`Auto betting for user ${userId}, mode: ${randomMode}, game: ${userSession.gameType}`);

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

            console.log(`Selected bet type: ${betType} (${betTypeStr}) for user ${userId}`);

            if ((userSession.gameType === 'TRX' || userSession.gameType === 'TRX_3MIN' ||
                userSession.gameType === 'TRX_5MIN' || userSession.gameType === 'TRX_10MIN') && 
                (betType === 10 || betType === 11 || betType === 12)) {
                console.log(`${userSession.gameType} game - Converting colour bet to BIG/SMALL for user ${userId}`);
                betType = Math.random() < 0.5 ? 13 : 14;
                betTypeStr = `${betType === 13 ? 'BIG' : 'SMALL'} (Colour Formula Converted)`;
            }

            const amount = await this.getCurrentBetAmount(userId);
            console.log(`Bet amount for user ${userId}: ${amount} (from sequence)`);

            const balance = await userSession.apiInstance.getBalance();

            if (amount > 0 && balance < amount) {
                console.log(`Insufficient balance for user ${userId}: ${balance} < ${amount}`);
                this.bot.sendMessage(userId, `Insufficient Balance!\n\nNeed: ${amount.toLocaleString()} K\nAvailable: ${balance.toLocaleString()} K`).catch(console.error);
                delete autoBettingTasks[userId];
                waitingForResults[userId] = false;
                return;
            }

            const botSession = await this.getBotSession(userId);
            const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
            const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);
            
            const netProfit = botSession.session_profit - botSession.session_loss;
            
            if (profitTarget > 0 && netProfit >= profitTarget) {
                console.log(`Profit target reached for user ${userId}: ${netProfit} >= ${profitTarget}`);
                this.bot.sendMessage(userId, `Profit Target Reached!\n\nCurrent Profit: ${netProfit.toLocaleString()} K\nTarget: ${profitTarget.toLocaleString()} K\n\nAuto bot stopped automatically.`).catch(console.error);
                delete autoBettingTasks[userId];
                waitingForResults[userId] = false;
                await this.saveBotSession(userId, false);
                return;
            }
            
            if (lossTarget > 0 && botSession.session_loss >= lossTarget) {
                console.log(`Loss target reached for user ${userId}: ${botSession.session_loss} >= ${lossTarget}`);
                this.bot.sendMessage(userId, `Loss Target Reached!\n\nCurrent Loss: ${botSession.session_loss.toLocaleString()} K\nTarget: ${lossTarget.toLocaleString()} K\n\nAuto bot stopped automatically.`).catch(console.error);
                delete autoBettingTasks[userId];
                waitingForResults[userId] = false;
                await this.saveBotSession(userId, false);
                return;
            }

            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));
            const totalSteps = amounts.length;
            
            const betMessage = `Placing Auto Bet\n\nIssue: ${issue}\nType: ${betTypeStr}\nAmount: ${amount.toLocaleString()} K\nStep: ${currentIndex + 1}/${totalSteps}`;
            await this.bot.sendMessage(userId, betMessage);

            console.log(`Placing bet for user ${userId}: ${betTypeStr} ${amount}K on ${issue} (Step ${currentIndex + 1}/${totalSteps})`);
            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                console.log(`Bet placed successfully for user ${userId}`);
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    console.log(`Starting issue checker for user ${userId}`);
                    this.startIssueChecker(userId);
                }

                const successMessage = `Bet Placed Successfully!\n\nIssue: ${result.issueId}\nType: ${betTypeStr}\nAmount: ${amount.toLocaleString()} K`;
                await this.bot.sendMessage(userId, successMessage);
                
            } else {
                console.log(`Bet failed for user ${userId}: ${result.message}`);
                
                if (result.message.includes('amount') || result.message.includes('betting')) {
                    console.log(`Amount error detected, resetting bet sequence for user ${userId}`);
                    await this.saveUserSetting(userId, 'current_bet_index', 0);
                    
                    const errorMessage = `Bet Failed - Amount Error\n\nError: ${result.message}\n\nBet sequence has been reset to step 1.`;
                    await this.bot.sendMessage(userId, errorMessage);
                } else {
                    const errorMessage = `Bet Failed\n\nError: ${result.message}`;
                    await this.bot.sendMessage(userId, errorMessage);
                }
                
                waitingForResults[userId] = false;
            }
        } catch (error) {
            console.error(`Error in placeAutoBet for user ${userId}:`, error);
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
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

            console.log(`Getting bet amount for user ${userId}: index=${currentIndex}, sequence=${betSequence}`);

            const actualIndex = currentIndex >= amounts.length ? 0 : currentIndex;
            const amount = amounts[actualIndex] || amounts[0] || 100;

            if (currentIndex >= amounts.length) {
                await this.saveUserSetting(userId, 'current_bet_index', 0);
                console.log(`Corrected invalid index: ${currentIndex} -> 0`);
            }

            console.log(`Final bet amount: ${amount}K (index: ${actualIndex})`);
            return amount;

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

    async setRandomBig(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'big');
            await this.clearFormulaPatterns(userId);
            
            await this.bot.sendMessage(chatId, "Random Mode Set\n\nRandom BIG - Always bet BIG\n\nBot will now always bet BIG in auto mode.");
        } catch (error) {
            console.error(`Error setting random big for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting random mode. Please try again.");
        }
    }

    async setRandomSmall(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'small');
            await this.clearFormulaPatterns(userId);
            
            await this.bot.sendMessage(chatId, "Random Mode Set\n\nRandom SMALL - Always bet SMALL\n\nBot will now always bet SMALL in auto mode.");
        } catch (error) {
            console.error(`Error setting random small for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting random mode. Please try again.");
        }
    }

    async setRandomBot(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'bot');
            await this.clearFormulaPatterns(userId);
            
            await this.bot.sendMessage(chatId, "Random Mode Set\n\nRandom Bot - Random BIG/SMALL\n\nBot will now randomly choose between BIG and SMALL in auto mode.");
        } catch (error) {
            console.error(`Error setting random bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting random mode. Please try again.");
        }
    }

    async setFollowBot(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'follow');
            await this.clearFormulaPatterns(userId);
            
            await this.bot.sendMessage(chatId, "Random Mode Set\n\nFollow Bot - Follow Last Result\n\nBot will now follow the last game result in auto mode.");
        } catch (error) {
            console.error(`Error setting follow bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting random mode. Please try again.");
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
            if (userSession.gameType === 'WINGO_30S') {
                defaultSequence = '50,100,200,400,800,1600,3200,6400';
            } else if (userSession.gameType === 'WINGO_3MIN') {
                defaultSequence = '100,500,1000,5000';
            } else if (userSession.gameType === 'WINGO_5MIN') {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            } else if (userSession.gameType === 'TRX') {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            } else if (userSession.gameType === 'TRX_3MIN') {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            } else if (userSession.gameType === 'TRX_5MIN') {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            } else if (userSession.gameType === 'TRX_10MIN') {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            } else {
                defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
            }
            
            const currentAmount = await this.getCurrentBetAmount(userId);
            
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern || "Not set";
            const colourPattern = patternsData.colour_pattern || "Not set";
            
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
                    formulaStatus += `\nBS Formula: ACTIVE (${bsPattern})`;
                    break;
                case 'colour_formula':
                    modeText = "Colour Formula";
                    formulaStatus += `\nColour Formula: ACTIVE (${colourPattern})`;
                    break;
                default:
                    modeText = "Random Bot";
            }
            
            if (bsPattern && bsPattern !== "Not set" && randomMode !== 'bs_formula') {
                formulaStatus += `\nBS Formula: INACTIVE (${bsPattern})`;
            }
            if (colourPattern && colourPattern !== "Not set" && randomMode !== 'colour_formula') {
                formulaStatus += `\nColour Formula: INACTIVE (${colourPattern})`;
            }

            const displaySequence = betSequence || defaultSequence;
            const amounts = displaySequence.split(',').map(x => {
                const num = parseInt(x.trim());
                return isNaN(num) ? 0 : num;
            });
            
            let formattedSequence = "";
            amounts.forEach((amount, index) => {
                if (index === currentIndex) {
                    formattedSequence += `${amount.toLocaleString()}`;
                } else {
                    formattedSequence += `${amount.toLocaleString()}`;
                }
                if (index < amounts.length - 1) {
                    formattedSequence += " -> ";
                }
            });

            const settingsText = `Bot Settings

Current Settings:
Betting Mode: ${modeText}
Bet Sequence: ${formattedSequence}
Current Step: ${currentIndex + 1}/${amounts.length}
Bot Status: ${botSession.is_running ? 'RUNNING' : 'STOPPED'}${formulaStatus}

Profit/Loss Targets:
Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}
Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}

Choose your betting mode:`;

            await this.bot.sendMessage(chatId, settingsText, {
                reply_markup: this.getBotSettingsKeyboard()
            });
        } catch (error) {
            console.error(`Error showing bot settings for user ${userId}:`, error);
            console.error('Error details:', error.stack);
            await this.bot.sendMessage(chatId, "Error loading bot settings. Please try again.");
        }
    }

    async showMyBets(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        try {
            const platform = userSession.platform || '777';
            const myBets = await this.getBetHistory(userId, platform, 10);
            
            if (!myBets || myBets.length === 0) {
                await this.bot.sendMessage(chatId, "No bet history found.");
                return;
            }

            const platformName = '777 Big Win';
            const gameType = userSession.gameType || 'WINGO';

            let betsText = `Your Recent Bets - ${platformName} (${gameType})\n\n`;
            
            let totalProfit = 0;
            let winCount = 0;
            let loseCount = 0;
            
            myBets.forEach((bet, i) => {
                const resultText = bet.result === "WIN" ? 
                    `WIN (+${(bet.profit_loss).toLocaleString()}K)` : 
                    `LOSE (-${bet.amount.toLocaleString()}K)`;
                
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


            await this.bot.sendMessage(chatId, betsText);
        } catch (error) {
            console.error(`Error showing my bets for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error getting bet history. Please try again.");
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

            const botInfoText = `BOT INFORMATION\n\nUser Info:\nUser ID: ${user_id_display}\nPhone: ${phone}\nPlatform: ${platformName}\nGame Type: ${gameType}\nBalance: ${balance.toLocaleString()} K\n\nBot Settings:\nBetting Mode: ${modeText}\nBet Sequence: ${betSequence}\nCurrent Bet: ${currentAmount.toLocaleString()} K (Step ${currentIndex + 1})\nBot Status: ${botSession.is_running ? 'RUNNING' : 'STOPPED'}\n\nTargets:\nProfit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}\nLoss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}\n\nLast Update: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, botInfoText);
            
        } catch (error) {
            console.error("Error in showBotInfo:", error);
            await this.bot.sendMessage(chatId, "Error loading bot information. Please try again.");
        }
    }

    async showBsFormula(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern || "Not set";
            
            const message = `Choose an option:`;
            
            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getBsPatternKeyboard()
            });
        } catch (error) {
            console.error(`Error showing BS formula for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error loading BS formula settings.");
        }
    }

    async showColourFormula(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const colourPattern = patternsData.colour_pattern || "Not set";
            
            const message = `Choose an option:`;
            
            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getColourPatternKeyboard()
            });
        } catch (error) {
            console.error(`Error showing Colour formula for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error loading Colour formula settings.");
        }
    }

    async viewBsPattern(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern;
            const currentIndex = patternsData.bs_current_index;
            
            if (!bsPattern) {
                await this.bot.sendMessage(chatId, "No BS Pattern Set!\n\nPlease set a BS pattern first using 'Set BS Pattern'.");
                return;
            }

            const patternArray = bsPattern.split(',');
            let patternDisplay = "";
            
            patternArray.forEach((betType, index) => {
                if (index === currentIndex) {
                    patternDisplay += `${betType}`;
                } else {
                    patternDisplay += betType;
                }
                if (index < patternArray.length - 1) {
                    patternDisplay += " -> ";
                }
            });

            const patternInfo = `Current BS Pattern\n\nPattern: ${patternDisplay}\nTotal Steps: ${patternArray.length}\nCurrent Step: ${currentIndex + 1}\n\nNext Bet: ${patternArray[currentIndex] === 'B' ? 'BIG' : 'SMALL'}`;

            await this.bot.sendMessage(chatId, patternInfo);
            
        } catch (error) {
            console.error(`Error viewing BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error viewing BS pattern. Please try again.");
        }
    }

    async viewColourPattern(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const colourPattern = patternsData.colour_pattern;
            const currentIndex = patternsData.colour_current_index;
            
            if (!colourPattern) {
                await this.bot.sendMessage(chatId, "No Colour Pattern Set!\n\nPlease set a Colour pattern first using 'Set Colour Pattern'.");
                return;
            }

            const patternArray = colourPattern.split(',');
            let patternDisplay = "";
            
            patternArray.forEach((colour, index) => {
                if (index === currentIndex) {
                    patternDisplay += `${colour}`;
                } else {
                    patternDisplay += colour;
                }
                if (index < patternArray.length - 1) {
                    patternDisplay += " -> ";
                }
            });

            const colourNames = {
                'G': 'GREEN',
                'R': 'RED', 
                'V': 'VIOLET'
            };

            const patternInfo = `Current Colour Pattern\n\nPattern: ${patternDisplay}\nTotal Steps: ${patternArray.length}\nCurrent Step: ${currentIndex + 1}\n\nNext Bet: ${colourNames[patternArray[currentIndex]] || patternArray[currentIndex]}`;

            await this.bot.sendMessage(chatId, patternInfo);
            
        } catch (error) {
            console.error(`Error viewing Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error viewing Colour pattern. Please try again.");
        }
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
                await this.bot.sendMessage(chatId, "Invalid bet sequence format!\n\nPlease enter valid numbers separated by commas.\nExample: 100,300,700,1600,3200,7600,16000,32000");
                return;
            }
            
            if (amounts.some(amount => amount <= 0)) {
                await this.bot.sendMessage(chatId, "Invalid bet amounts!\n\nAll bet amounts must be positive numbers.");
                return;
            }
            
            let validationMessage = "";
            if (gameType === 'WINGO_30S') {
                const recommendedAmounts = [50, 100, 200, 400, 800, 1600, 3200, 6400];
                validationMessage = `\n\nWINGO 30S Recommended: ${recommendedAmounts.join(', ')}`;
            } else if (gameType === 'WINGO_3MIN') {
                const recommendedAmounts = [100, 500, 1000, 5000];
                validationMessage = `\n\nWINGO 3MIN Recommended: ${recommendedAmounts.join(', ')}`;
            } else if (gameType === 'WINGO_5MIN') {
                const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                validationMessage = `\n\nWINGO 5MIN Recommended: ${recommendedAmounts.join(', ')}`;
            } else if (gameType === 'TRX') {
                const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                validationMessage = `\n\nTRX Recommended: ${recommendedAmounts.join(', ')}`;
            } else if (gameType === 'TRX_3MIN') {
                const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                validationMessage = `\n\nTRX 3MIN Recommended: ${recommendedAmounts.join(', ')}`;
            } else if (gameType === 'TRX_5MIN') {
                const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                validationMessage = `\n\nTRX 5MIN Recommended: ${recommendedAmounts.join(', ')}`;
            } else if (gameType === 'TRX_10MIN') {
                const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                validationMessage = `\n\nTRX 10MIN Recommended: ${recommendedAmounts.join(', ')}`;
            } else {
                const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
                validationMessage = `\n\nWINGO Recommended: ${recommendedAmounts.join(', ')}`;
            }
            
            await this.saveUserSetting(userId, 'bet_sequence', betSequence);
            await this.saveUserSetting(userId, 'current_bet_index', 0);
            
            const currentAmount = amounts[0];
            
            const successMessage = `Bet Sequence Updated!\n\nNew Sequence: ${betSequence}\nCurrent Bet: ${currentAmount.toLocaleString()} K (Step 1)${validationMessage}\n\nBot will now use this sequence for auto betting.`;
            
            await this.bot.sendMessage(chatId, successMessage, {
                reply_markup: this.getBotSettingsKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting bet sequence for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting bet sequence.\n\nPlease try again with valid format:\nExample: 100,300,700,1600,3200,7600,16000,32000");
        }
    }

    async handleSetProfitTarget(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            
            const profitTarget = parseInt(text.trim());
            
            if (isNaN(profitTarget) || profitTarget < 0) {
                await this.bot.sendMessage(chatId, "Invalid profit target!\n\nPlease enter a valid positive number.\nEnter 0 to disable profit target.");
                return;
            }
            
            await this.saveUserSetting(userId, 'profit_target', profitTarget);
            
            let message;
            if (profitTarget === 0) {
                message = "Profit Target Disabled!\n\nBot will no longer stop automatically when reaching profit target.";
            } else {
                message = `Profit Target Set!\n\nTarget: ${profitTarget.toLocaleString()} K\n\nBot will automatically stop when profit reaches ${profitTarget.toLocaleString()} K.`;
            }
            
            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getBotSettingsKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting profit target for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting profit target.\n\nPlease try again.");
        }
    }

    async handleSetLossTarget(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            
            const lossTarget = parseInt(text.trim());
            
            if (isNaN(lossTarget) || lossTarget < 0) {
                await this.bot.sendMessage(chatId, "Invalid loss target!\n\nPlease enter a valid positive number.\nEnter 0 to disable loss target.");
                return;
            }
            
            await this.saveUserSetting(userId, 'loss_target', lossTarget);
            
            let message;
            if (lossTarget === 0) {
                message = "Loss Target Disabled!\n\nBot will no longer stop automatically when reaching loss target.";
            } else {
                message = `Loss Target Set!\n\nTarget: ${lossTarget.toLocaleString()} K\n\nBot will automatically stop when loss reaches ${lossTarget.toLocaleString()} K.`;
            }
            
            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getBotSettingsKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting loss target for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting loss target.\n\nPlease try again.");
        }
    }

    async handleSetBsPattern(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            
            const pattern = text.trim().toUpperCase();
            const validPattern = /^[BS,]+$/.test(pattern);
            
            if (!validPattern || pattern.length === 0) {
                await this.bot.sendMessage(chatId, "Invalid BS Pattern!\n\nPlease use ONLY:\n- B for BIG\n- S for SMALL\n- Comma (,) to separate\n\nExamples:\n• B,S,B,B\n• S,S,B\n• B,B,B,S");
                return;
            }

            const patternArray = pattern.split(',').map(p => p.trim()).filter(p => p === 'B' || p === 'S');
            
            if (patternArray.length === 0) {
                await this.bot.sendMessage(chatId, "Invalid BS Pattern!\n\nPattern must contain at least one B or S.");
                return;
            }

            const cleanPattern = patternArray.join(',');

            await this.saveBsPattern(userId, cleanPattern);
            
            await this.saveUserSetting(userId, 'random_betting', 'bs_formula');

            const successMessage = `BS Pattern Set Successfully!\n\nPattern: ${cleanPattern}\nLength: ${patternArray.length} steps\nCurrent Index: 1\n\nBot will now use BS Formula pattern for auto betting.`;

            await this.bot.sendMessage(chatId, successMessage, {
                reply_markup: this.getBsPatternKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting BS pattern.\n\nPlease try again.");
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
                await this.bot.sendMessage(chatId, "Invalid Colour Pattern!\n\nPlease use ONLY:\n- G for GREEN\n- R for RED\n- V for VIOLET\n- Comma (,) to separate\n\nExamples:\n• R,G,V,R\n• G,V,R\n• R,R,G");
                return;
            }

            const patternArray = pattern.split(',').map(p => p.trim()).filter(p => p === 'G' || p === 'R' || p === 'V');
            
            if (patternArray.length === 0) {
                await this.bot.sendMessage(chatId, "Invalid Colour Pattern!\n\nPattern must contain at least one G, R or V.");
                return;
            }

            const cleanPattern = patternArray.join(',');

            await this.saveColourPattern(userId, cleanPattern);
            
            await this.saveUserSetting(userId, 'random_betting', 'colour_formula');

            const successMessage = `Colour Pattern Set Successfully!\n\nPattern: ${cleanPattern}\nLength: ${patternArray.length} steps\nCurrent Index: 1\n\nBot will now use Colour Formula pattern for auto betting.`;

            await this.bot.sendMessage(chatId, successMessage, {
                reply_markup: this.getColourPatternKeyboard()
            });
            
            userSession.step = 'main';
            
        } catch (error) {
            console.error(`Error setting Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting Colour pattern.\n\nPlease try again.");
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

    async clearBsPattern(chatId, userId) {
        try {
            await this.clearFormulaPatterns(userId, 'bs');
            await this.saveUserSetting(userId, 'random_betting', 'bot');
            
            await this.bot.sendMessage(chatId, "BS Pattern Cleared!\n\nBS Formula mode has been disabled. Bot will return to Random Bot mode.", {
                reply_markup: this.getBsPatternKeyboard()
            });
            
        } catch (error) {
            console.error(`Error clearing BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error clearing BS pattern. Please try again.");
        }
    }

    async clearColourPattern(chatId, userId) {
        try {
            await this.clearFormulaPatterns(userId, 'colour');
            await this.saveUserSetting(userId, 'random_betting', 'bot');
            
            await this.bot.sendMessage(chatId, "Colour Pattern Cleared!\n\nColour Formula mode has been disabled. Bot will return to Random Bot mode.", {
                reply_markup: this.getColourPatternKeyboard()
            });
            
        } catch (error) {
            console.error(`Error clearing Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error clearing Colour pattern. Please try again.");
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

        const message = match[1];
        if (!message) {
            await this.bot.sendMessage(chatId, "Please provide a message to broadcast.\nUsage: /broadcast Your message here");
            return;
        }

        try {
            const users = await this.db.all('SELECT user_id FROM users');
            const totalUsers = users.length;
            
            if (totalUsers === 0) {
                await this.bot.sendMessage(chatId, "No users found to broadcast.");
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, `Broadcasting message to ${totalUsers} users...\n\n0/${totalUsers} (0%)`);
            
            let successCount = 0;
            let failCount = 0;
            
            for (let i = 0; i < users.length; i++) {
                const user = users[i];
                try {
                    await this.bot.sendMessage(user.user_id, `📢 **BROADCAST MESSAGE** 📢\n\n${message}\n\n_From Admin_`, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    successCount++;
                    
                    if (i % 10 === 0 || i === users.length - 1) {
                        const progress = Math.floor((i + 1) / totalUsers * 100);
                        await this.bot.editMessageText(
                            `Broadcasting message to ${totalUsers} users...\n\n${i + 1}/${totalUsers} (${progress}%)\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`,
                            {
                                chat_id: chatId,
                                message_id: loadingMsg.message_id
                            }
                        );
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    failCount++;
                    console.error(`Failed to send broadcast to user ${user.user_id}:`, error.message);
                }
            }

            const resultText = `📢 **BROADCAST COMPLETED** 📢\n\n✅ Successfully sent to: ${successCount} users\n❌ Failed to send: ${failCount} users\n📊 Total users: ${totalUsers}\n📝 Message length: ${message.length} characters\n⏰ Sent at: ${getMyanmarTime()}`;
            
            await this.bot.editMessageText(resultText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
            });
            
        } catch (error) {
            console.error('Broadcast error:', error);
            await this.bot.sendMessage(chatId, `Broadcast failed: ${error.message}`);
        }
    }

    async handleBroadcastActive(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const message = match[1];
        if (!message) {
            await this.bot.sendMessage(chatId, "Please provide a message to broadcast.\nUsage: /msg Your message here");
            return;
        }

        try {
            const activeUsers = await this.db.all(`
                SELECT DISTINCT user_id 
                FROM bot_sessions 
                WHERE is_running = 1 
                OR last_activity > datetime('now', '-1 hour')
            `);
            
            const totalActiveUsers = activeUsers.length;
            
            if (totalActiveUsers === 0) {
                await this.bot.sendMessage(chatId, "No active users found.");
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, `Broadcasting to ${totalActiveUsers} active users...\n\n0/${totalActiveUsers} (0%)`);
            
            let successCount = 0;
            let failCount = 0;
            
            for (let i = 0; i < activeUsers.length; i++) {
                const user = activeUsers[i];
                try {
                    await this.bot.sendMessage(user.user_id, `${message}`, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    successCount++;
                    
                    if (i % 5 === 0 || i === activeUsers.length - 1) {
                        const progress = Math.floor((i + 1) / totalActiveUsers * 100);
                        await this.bot.editMessageText(
                            `Broadcasting to ${totalActiveUsers} active users...\n\n${i + 1}/${totalActiveUsers} (${progress}%)\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`,
                            {
                                chat_id: chatId,
                                message_id: loadingMsg.message_id
                            }
                        );
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 150));
                    
                } catch (error) {
                    failCount++;
                    console.error(`Failed to send to active user ${user.user_id}:`, error.message);
                }
            }

            const resultText = `📢**ACTIVE BROADCAST COMPLETED**\n\n✅ Successfully sent to: ${successCount} active users\n❌ Failed to send: ${failCount} users\nTotal active users: ${totalActiveUsers}\nSent at: ${getMyanmarTime()}`;
            
            await this.bot.editMessageText(resultText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
            });
            
        } catch (error) {
            console.error('Active broadcast error:', error);
            await this.bot.sendMessage(chatId, `Active broadcast failed: ${error.message}`);
        }
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
console.log("Bet Sequence System: WINGO 30S: 50,100,200,400,800,1600,3200,6400 | WINGO 3MIN: 100,500,1000,5000 | WINGO 5MIN: 100,300,700,1600,3200,7600,16000,32000 | TRX/WINGO/TRX 3MIN/TRX 5MIN/TRX 10MIN: 100,300,700,1600,3200,7600,16000,32000");
console.log("Profit/Loss Target System");
console.log("Auto Statistics Tracking");
console.log("Colour Betting Support (RED, GREEN, VIOLET)");
console.log("TRX Game Support: ENABLED");
console.log("TRX 3 MIN Support: ENABLED (TypeId: 14)");
console.log("TRX 5 MIN Support: ENABLED (TypeId: 15)");
console.log("TRX 10 MIN Support: ENABLED (TypeId: 16)");
console.log("WINGO 30S Support: ENABLED");
console.log("WINGO 3 MIN Support: ENABLED");
console.log("WINGO 5 MIN Support: ENABLED");
console.log("Win/Loss Messages: ENABLED");
console.log("Supported Platforms: 777 Big Win (WINGO & TRX)");
console.log("Myanmar Time System: ENABLED");
console.log("Press Ctrl+C to stop.");

const bot = new AutoLotteryBot();

process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    process.exit();
});
