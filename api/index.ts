import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Supabase Configuration (Embedded to fix Vercel Module Resolution)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('Missing Supabase environment variables! Queries will fail.');
}

// Server-side Supabase client with service role key
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

import { authenticateToken, AuthRequest } from './middleware/auth';
import { sendContactNotification } from './utils/email';
import { generateContent } from './utils/ai';

dotenv.config({ path: '.env.local' });

const app = express();

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(express.json());

// ============ AUTHENTICATION ROUTES ============

// Login endpoint
app.post('/api/v1/auth/login', async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Sign in with Supabase Auth
        const { data, error } = await supabaseAdmin.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Return user and session
        res.json({
            user: data.user,
            session: data.session,
            token: data.session?.access_token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Initialize admin user
app.get('/api/v1/admin-init', async (req: Request, res: Response) => {
    try {
        const adminEmail = 'admin@intravvel.com';
        const adminPassword = 'admin123';

        // Check if admin already exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const adminExists = existingUsers?.users.some((u: any) => u.email === adminEmail);

        if (adminExists) {
            return res.json({ message: 'Admin user already exists', email: adminEmail });
        }

        // Create admin user
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email: adminEmail,
            password: adminPassword,
            email_confirm: true,
            user_metadata: { role: 'admin' }
        });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            message: 'Admin user created successfully',
            email: adminEmail,
            password: adminPassword,
            warning: 'Please change this password immediately!'
        });
    } catch (error) {
        console.error('Admin init error:', error);
        res.status(500).json({ error: 'Failed to initialize admin' });
    }
});

// ============ SERVICES ROUTES ============

// Get all services
app.get('/api/v1/services', async (req: Request, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('services')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Get services error:', error);
        res.status(500).json({ error: 'Failed to fetch services' });
    }
});

// Get single service
app.get('/api/v1/services/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('services')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error('Get service error:', error);
        res.status(404).json({ error: 'Service not found' });
    }
});

// Create service (protected)
app.post('/api/v1/services', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        const { title, description, price, duration, image_url, featured } = req.body;

        if (!title || !description || !price) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { data, error } = await supabaseAdmin
            .from('services')
            .insert([{
                title,
                description,
                price,
                duration,
                image_url,
                featured: featured || false
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json(data);
    } catch (error) {
        console.error('Create service error:', error);
        res.status(500).json({ error: 'Failed to create service' });
    }
});

// Update service (protected)
app.put('/api/v1/services/:id', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { title, description, price, duration, image_url, featured } = req.body;

        const { data, error } = await supabaseAdmin
            .from('services')
            .update({
                title,
                description,
                price,
                duration,
                image_url,
                featured,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error('Update service error:', error);
        res.status(500).json({ error: 'Failed to update service' });
    }
});

// Delete service (protected)
app.delete('/api/v1/services/:id', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('services')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Service deleted successfully' });
    } catch (error) {
        console.error('Delete service error:', error);
        res.status(500).json({ error: 'Failed to delete service' });
    }
});

// ============ MESSAGES ROUTES ============

// Get all messages (protected)
app.get('/api/v1/messages', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('messages')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Update message status (protected)
app.put('/api/v1/messages/:id', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const { data, error } = await supabaseAdmin
            .from('messages')
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error('Update message error:', error);
        res.status(500).json({ error: 'Failed to update message' });
    }
});

// Delete message (protected)
app.delete('/api/v1/messages/:id', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('messages')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Message deleted successfully' });
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// ============ CONTACT FORM ROUTE ============

// Submit contact form (public)
app.post('/api/v1/contact', async (req: Request, res: Response) => {
    try {
        const { name, email, subject, message } = req.body;

        if (!name || !email || !subject || !message) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Save to database
        const { data, error } = await supabaseAdmin
            .from('messages')
            .insert([{
                name,
                email,
                subject,
                message,
                status: 'new'
            }])
            .select()
            .single();

        if (error) throw error;

        // Send email notification (non-blocking)
        sendContactNotification({ name, email, subject, message }).catch(err =>
            console.error('Email notification failed:', err)
        );

        res.status(201).json({
            message: 'Message sent successfully',
            data
        });
    } catch (error) {
        console.error('Contact form error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ============ SITE CONTENT ROUTES ============

// Get site content
app.get('/api/v1/site-content', async (req: Request, res: Response) => {
    try {
        const { section } = req.query;

        let query = supabaseAdmin.from('site_content').select('*');

        if (section) {
            query = query.eq('section', section);
            const { data, error } = await query.single();
            if (error && error.code !== 'PGRST116') throw error;
            return res.json(data || null);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Get site content error:', error);
        res.status(500).json({ error: 'Failed to fetch content' });
    }
});

// Update site content (protected)
app.put('/api/v1/site-content/:section', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        const { section } = req.params;
        const { data: contentData } = req.body;

        // Try to update first
        const { data: existing } = await supabaseAdmin
            .from('site_content')
            .select('id')
            .eq('section', section)
            .single();

        let result;
        if (existing) {
            // Update existing
            const { data, error } = await supabaseAdmin
                .from('site_content')
                .update({
                    data: contentData,
                    updated_at: new Date().toISOString()
                })
                .eq('section', section)
                .select()
                .single();

            if (error) throw error;
            result = data;
        } else {
            // Insert new
            const { data, error } = await supabaseAdmin
                .from('site_content')
                .insert([{
                    section,
                    data: contentData
                }])
                .select()
                .single();

            if (error) throw error;
            result = data;
        }

        res.json(result);
    } catch (error) {
        console.error('Update site content error:', error);
        res.status(500).json({ error: 'Failed to update content' });
    }
});

// ============ AI GENERATION ROUTE ============

// Generate AI content (protected)
app.post('/api/v1/ai/generate', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const content = await generateContent(prompt);

        res.json({ content });
    } catch (error) {
        console.error('AI generation error:', error);
        res.status(500).json({ error: 'Failed to generate content' });
    }
});

// ============ FILE UPLOAD ROUTE ============

// Upload file (protected) - Using Supabase Storage
app.post('/api/v1/upload', authenticateToken as any, async (req: AuthRequest, res: Response) => {
    try {
        // For now, return a placeholder
        // In production, implement Supabase Storage upload
        res.json({
            url: 'https://via.placeholder.com/400x300',
            message: 'File upload not yet implemented. Configure Supabase Storage.'
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Health check
app.get('/api/v1/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export for Vercel serverless
export default app;
