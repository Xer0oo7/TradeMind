-- ============================================================
-- TradeMind Database Schema for MySQL 8.0+
-- ============================================================

CREATE DATABASE IF NOT EXISTS trademind CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE trademind;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. Products Table
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    base_price DECIMAL(12, 2) NOT NULL,
    cost_price DECIMAL(12, 2) NOT NULL,
    min_acceptable_price DECIMAL(12, 2) NOT NULL,
    max_loss_percent DECIMAL(5, 2) DEFAULT 0.00,
    mode VARCHAR(32) DEFAULT 'MAX_PROFIT',
    max_rounds INT DEFAULT 10,
    category VARCHAR(100) DEFAULT 'General',
    status VARCHAR(32) DEFAULT 'active',
    total_sessions INT DEFAULT 0,
    accepted_deals INT DEFAULT 0,
    avg_margin DECIMAL(6, 2) DEFAULT 0.00,
    revenue DECIMAL(14, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3. Chat Sessions Table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    mode VARCHAR(32) DEFAULT 'MAX_PROFIT',
    base_price DECIMAL(12, 2) NOT NULL,
    cost_price DECIMAL(12, 2) NOT NULL,
    min_price DECIMAL(12, 2) NOT NULL,
    max_rounds INT DEFAULT 10,
    rounds_used INT DEFAULT 0,
    status VARCHAR(32) DEFAULT 'active',
    final_price DECIMAL(12, 2) DEFAULT NULL,
    final_decision VARCHAR(32) DEFAULT NULL,
    deal_closed TINYINT(1) DEFAULT 0,
    buyer_last_offer DECIMAL(12, 2) DEFAULT NULL,
    seller_last_offer DECIMAL(12, 2) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    user_id INT NOT NULL,
    round_number INT DEFAULT 0,
    user_message TEXT,
    bot_reply TEXT,
    offered_price DECIMAL(12, 2) DEFAULT NULL,
    counter_price DECIMAL(12, 2) DEFAULT NULL,
    decision VARCHAR(32) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. Callback Requests Table
CREATE TABLE IF NOT EXISTS callback_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    session_id INT NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    product_name VARCHAR(255) DEFAULT NULL,
    negotiation_status VARCHAR(64) DEFAULT NULL,
    final_price DECIMAL(12, 2) DEFAULT NULL,
    status VARCHAR(32) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 6. Email Settings Table
CREATE TABLE IF NOT EXISTS email_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    smtp_host VARCHAR(255) DEFAULT 'smtp.gmail.com',
    smtp_port INT DEFAULT 587,
    smtp_user VARCHAR(255) DEFAULT '',
    smtp_password VARCHAR(255) DEFAULT '',
    from_email VARCHAR(255) DEFAULT '',
    from_name VARCHAR(100) DEFAULT 'TradeMind',
    use_tls TINYINT(1) DEFAULT 1,
    notifications_enabled TINYINT(1) DEFAULT 1,
    notify_on_deal TINYINT(1) DEFAULT 1,
    notify_on_new_session TINYINT(1) DEFAULT 1,
    notify_on_api_key TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 7. API Keys Table
CREATE TABLE IF NOT EXISTS api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    api_key VARCHAR(255) NOT NULL UNIQUE,
    label VARCHAR(255) DEFAULT 'Default',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL DEFAULT NULL,
    is_active TINYINT(1) DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
