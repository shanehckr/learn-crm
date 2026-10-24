-- Catering CRM database schema.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE roles (
    role_id INT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (role_name) VALUES
    ('Admin'),
    ('Manager'),
    ('Sales Staff'),
    ('Customer Service Staff');

CREATE TABLE users (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    full_name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    role_id INT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role
        FOREIGN KEY (role_id) REFERENCES roles(role_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contacts (
    contact_id INT PRIMARY KEY AUTO_INCREMENT,
    customer_name VARCHAR(150) NOT NULL,
    email VARCHAR(100) NOT NULL,
    contact_number VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leads (
    lead_id INT PRIMARY KEY AUTO_INCREMENT,
    inquiry_event_name VARCHAR(80) NOT NULL,
    contact_id INT NOT NULL,
    assigned_user_id INT NULL,
    stage ENUM(
        'New Inquiry',
        'In Progress',
        'In Discussion',
        'Declined'
    ) NOT NULL DEFAULT 'New Inquiry',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_leads_contact
        FOREIGN KEY (contact_id) REFERENCES contacts(contact_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_assigned_user
        FOREIGN KEY (assigned_user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE deals (
    deal_id INT PRIMARY KEY AUTO_INCREMENT,
    inquiry_event_name VARCHAR(150) NOT NULL,
    lead_id INT NOT NULL UNIQUE,
    assigned_user_id INT NOT NULL,
    stage ENUM(
        'Quotation Preparation',
        'Quotation Sent',
        'Negotiation',
        'Confirmed',
        'Declined'
    ) NOT NULL DEFAULT 'Quotation Preparation',
    food_orders TEXT NOT NULL,
    number_of_guests INT NOT NULL,
    event_date DATE NOT NULL,
    service_arrangement ENUM(
        'Customer Pickup',
        'Food Delivery',
        'On-site Catering'
    ) NOT NULL,
    pickup_date DATE NULL,
    pickup_time TIME NULL,
    delivery_address VARCHAR(255) NULL,
    delivery_date DATE NULL,
    delivery_time TIME NULL,
    event_venue VARCHAR(255) NULL,
    event_start_time TIME NULL,
    event_end_time TIME NULL,
    quotation_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_deals_lead
        FOREIGN KEY (lead_id) REFERENCES leads(lead_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_deals_assigned_user
        FOREIGN KEY (assigned_user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_deals_positive_guests
        CHECK (number_of_guests > 0),
    CONSTRAINT chk_deals_nonnegative_quotation
        CHECK (quotation_amount >= 0),
    CONSTRAINT chk_deals_arrangement_fields
        CHECK (
            (
                service_arrangement = 'Customer Pickup'
                AND pickup_date IS NOT NULL
                AND pickup_time IS NOT NULL
                AND delivery_address IS NULL
                AND delivery_date IS NULL
                AND delivery_time IS NULL
                AND event_venue IS NULL
                AND event_start_time IS NULL
                AND event_end_time IS NULL
            )
            OR
            (
                service_arrangement = 'Food Delivery'
                AND delivery_address IS NOT NULL
                AND delivery_date IS NOT NULL
                AND delivery_time IS NOT NULL
                AND pickup_date IS NULL
                AND pickup_time IS NULL
                AND event_venue IS NULL
                AND event_start_time IS NULL
                AND event_end_time IS NULL
            )
            OR
            (
                service_arrangement = 'On-site Catering'
                AND event_venue IS NOT NULL
                AND event_start_time IS NOT NULL
                AND event_end_time IS NOT NULL
                AND pickup_date IS NULL
                AND pickup_time IS NULL
                AND delivery_address IS NULL
                AND delivery_date IS NULL
                AND delivery_time IS NULL
            )
        )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tickets (
    ticket_id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_name VARCHAR(150) NOT NULL,
    contact_id INT NOT NULL,
    description VARCHAR(150) NOT NULL,
    status ENUM('Open', 'Pending', 'Resolved') NOT NULL DEFAULT 'Open',
    priority ENUM('High', 'Medium', 'Low') NOT NULL DEFAULT 'Medium',
    assigned_user_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tickets_contact
        FOREIGN KEY (contact_id) REFERENCES contacts(contact_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_tickets_assigned_user
        FOREIGN KEY (assigned_user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activities (
    activity_id INT PRIMARY KEY AUTO_INCREMENT,
    activity_name VARCHAR(150) NOT NULL,
    contact_id INT NOT NULL,
    lead_id INT NULL,
    deal_id INT NULL,
    ticket_id INT NULL,
    activity_type ENUM('Call', 'Email', 'Meeting', 'Other') NOT NULL,
    due_date DATE NOT NULL,
    assigned_user_id INT NOT NULL,
    status ENUM(
        'Upcoming',
        'In Progress',
        'Completed',
        'Cancelled'
    ) NOT NULL DEFAULT 'Upcoming',
    notes VARCHAR(150) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_activities_contact
        FOREIGN KEY (contact_id) REFERENCES contacts(contact_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_activities_lead
        FOREIGN KEY (lead_id) REFERENCES leads(lead_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_activities_deal
        FOREIGN KEY (deal_id) REFERENCES deals(deal_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_activities_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_activities_assigned_user
        FOREIGN KEY (assigned_user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_activities_primary_reference CHECK (
        (lead_id IS NOT NULL AND deal_id IS NULL)
        OR
        (lead_id IS NULL AND deal_id IS NOT NULL)
        OR
        (lead_id IS NULL AND deal_id IS NULL AND ticket_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
