"""
BDPS Backend API v2
Flask + Supabase (PostgreSQL + Auth)

Run:
    pip install -r requirements.txt
    python app.py

Requires a .env file with:
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_KEY=your-service-role-key      (service role, NOT anon — needed to bypass RLS
                                              for admin operations and apply our own ownership checks)
    SUPABASE_JWT_SECRET=your-jwt-secret      (Settings -> API -> JWT Settings -> JWT Secret)
"""
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from supabase import create_client, Client
import os
from dotenv import load_dotenv
from analytics import calculate_score, get_recommendations, get_tier
from auth import login_required, admin_required, AuthError

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["https://famous-lolly-ab178a.netlify.app/"],
     supports_credentials=True,
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
SUPABASE_ANON_KEY = os.getenv('SUPABASE_ANON_KEY', SUPABASE_KEY)

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL / SUPABASE_KEY in .env file")
if not os.getenv('SUPABASE_JWT_SECRET'):
    raise ValueError(
        "Missing SUPABASE_JWT_SECRET in .env file (Settings -> API -> JWT Settings)")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TABLE = 'businesses'
PROFILES = 'profiles'

require_login = login_required(lambda: supabase)
require_admin = admin_required(lambda: supabase)


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────
def row_to_business(row: dict) -> dict:
    """Convert DB row (snake_case) to the shape the frontend expects (camelCase)."""
    return {
        'id': row['id'],
        'ownerId': row.get('owner_id'),
        'name': row['name'],
        'category': row['category'],
        'city': row['city'],
        'rating': float(row['rating']),
        'reviews': int(row['reviews']),
        'website': bool(row['website']),
        'instagram': row.get('instagram', ''),
        'followers': int(row['followers']),
        'engagement': float(row['engagement']),
        'lastPost': int(row['last_post']),
        'score': int(row['score']),
        'createdAt': row.get('created_at'),
        'updatedAt': row.get('updated_at'),
    }


def business_from_payload(data: dict) -> dict:
    """Convert incoming JSON (camelCase) into DB column names (snake_case)."""
    return {
        'name': data.get('name'),
        'category': data.get('category'),
        'city': data.get('city', 'Unknown'),
        'rating': float(data.get('rating', 4.0)),
        'reviews': int(data.get('reviews', 0)),
        'website': bool(data.get('website', False)),
        'instagram': data.get('instagram', ''),
        'followers': int(data.get('followers', 0)),
        'engagement': float(data.get('engagement', 0)),
        'last_post': int(data.get('lastPost', 30)),
    }


def row_to_profile(row: dict) -> dict:
    return {
        'id': row['id'],
        'email': row['email'],
        'fullName': row.get('full_name', ''),
        'role': row.get('role', 'user'),
        'isActive': bool(row.get('is_active', True)),
        'createdAt': row.get('created_at'),
    }


def validate_business_payload(data: dict) -> list:
    """Returns a list of human-readable validation error strings, empty if valid."""
    errors = []
    name = (data.get('name') or '').strip()
    city = (data.get('city') or '').strip()
    category = data.get('category')

    valid_categories = ['Restaurant', 'Retail', 'Healthcare',
                        'Education', 'Hotel', 'Fitness', 'Tech', 'Beauty', 'Other']

    if not name:
        errors.append('Business name is required')
    elif len(name) > 255:
        errors.append('Business name must be under 255 characters')

    if not city:
        errors.append('City is required')

    if category not in valid_categories:
        errors.append(
            f'Category must be one of: {", ".join(valid_categories)}')

    try:
        rating = float(data.get('rating', 4.0))
        if not (0 <= rating <= 5):
            errors.append('Rating must be between 0 and 5')
    except (TypeError, ValueError):
        errors.append('Rating must be a number')

    try:
        reviews = int(data.get('reviews', 0))
        if reviews < 0:
            errors.append('Reviews cannot be negative')
    except (TypeError, ValueError):
        errors.append('Reviews must be a whole number')

    try:
        followers = int(data.get('followers', 0))
        if followers < 0:
            errors.append('Followers cannot be negative')
    except (TypeError, ValueError):
        errors.append('Followers must be a whole number')

    try:
        engagement = float(data.get('engagement', 0))
        if engagement < 0:
            errors.append('Engagement rate cannot be negative')
    except (TypeError, ValueError):
        errors.append('Engagement rate must be a number')

    try:
        last_post = int(data.get('lastPost', 30))
        if last_post < 0:
            errors.append('Days since last post cannot be negative')
    except (TypeError, ValueError):
        errors.append('Days since last post must be a whole number')

    return errors


def get_business_or_404(business_id):
    response = supabase.table(TABLE).select(
        '*').eq('id', business_id).execute()
    if not response.data:
        return None
    return response.data[0]


def can_modify(business_row, user) -> bool:
    return user['role'] == 'admin' or business_row['owner_id'] == user['id']


# ──────────────────────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────────────────────
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'version': '3.0.0', 'database': 'supabase'}), 200


# @app.route('/api/test-auth', methods=['GET'])
# def test_auth():
#     """Temporary debug route - shows what auth header Flask receives"""
#     import os
#     auth = request.headers.get('Authorization', 'MISSING')
#     secret = os.getenv('SUPABASE_JWT_SECRET', '')
#     return jsonify({
#         'auth_header_present': auth != 'MISSING',
#         'auth_header_prefix': auth[:20] if auth != 'MISSING' else 'MISSING',
#         'jwt_secret_set': bool(secret),
#         'jwt_secret_length': len(secret)
#     }), 200


# ──────────────────────────────────────────────────────────────
# Current user
# ──────────────────────────────────────────────────────────────
@app.route('/api/me', methods=['GET'])
@require_login
def get_me():
    return jsonify(row_to_profile(g.user)), 200


@app.route('/api/me', methods=['PUT'])
@require_login
def update_me():
    try:
        data = request.get_json() or {}
        full_name = (data.get('fullName') or '').strip()
        if not full_name:
            return jsonify({'error': 'Full name is required'}), 400
        if len(full_name) > 255:
            return jsonify({'error': 'Full name must be under 255 characters'}), 400

        response = supabase.table(PROFILES).update(
            {'full_name': full_name}).eq('id', g.user['id']).execute()
        if not response.data:
            return jsonify({'error': 'Could not update profile'}), 500
        return jsonify(row_to_profile(response.data[0])), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Businesses — list / create
# ──────────────────────────────────────────────────────────────
@app.route('/api/businesses', methods=['GET'])
@require_login
def get_businesses():
    """
    List businesses. Regular users see only their own; admins see all
    (or can filter to a specific owner via ?ownerId=).
    Supports: ?q= (search), ?category=, ?city=, ?sort=score|name|rating|reviews|created_at,
              ?order=asc|desc, ?page=, ?pageSize=
    """
    try:
        category = request.args.get('category')
        city = request.args.get('city')
        q = request.args.get('q')
        sort = request.args.get('sort', 'score')
        order = request.args.get('order', 'desc')
        page = max(int(request.args.get('page', 1)), 1)
        page_size = min(max(int(request.args.get('pageSize', 12)), 1), 100)

        valid_sorts = {'score': 'score', 'name': 'name', 'rating': 'rating',
                       'reviews': 'reviews', 'created_at': 'created_at', 'followers': 'followers'}
        sort_col = valid_sorts.get(sort, 'score')

        query = supabase.table(TABLE).select('*')

        if g.user['role'] != 'admin':
            query = query.eq('owner_id', g.user['id'])
        elif request.args.get('ownerId'):
            query = query.eq('owner_id', request.args.get('ownerId'))

        if category and category != 'All':
            query = query.eq('category', category)
        if city and city != 'All':
            query = query.eq('city', city)

        query = query.order(sort_col, desc=(order == 'desc'))

        response = query.execute()
        rows = response.data

        if q:
            q_lower = q.lower()
            rows = [r for r in rows if q_lower in r['name'].lower()
                    or q_lower in r['category'].lower() or q_lower in r['city'].lower()]

        total = len(rows)
        start = (page - 1) * page_size
        page_rows = rows[start:start + page_size]

        businesses = [row_to_business(r) for r in page_rows]
        return jsonify({
            'businesses': businesses,
            'pagination': {
                'page': page,
                'pageSize': page_size,
                'total': total,
                'totalPages': max((total + page_size - 1) // page_size, 1)
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/businesses', methods=['POST'])
@require_login
def create_business():
    try:
        data = request.get_json() or {}

        errors = validate_business_payload(data)
        if errors:
            return jsonify({'error': 'Validation failed', 'details': errors}), 400

        business = business_from_payload(data)
        business['owner_id'] = g.user['id']
        business['score'] = calculate_score(
            rating=business['rating'], reviews=business['reviews'],
            website=business['website'], followers=business['followers'],
            engagement=business['engagement'], lastPost=business['last_post']
        )

        response = supabase.table(TABLE).insert(business).execute()
        created = row_to_business(response.data[0])
        return jsonify(created), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Businesses — single record
# ──────────────────────────────────────────────────────────────
@app.route('/api/businesses/<int:business_id>', methods=['GET'])
@require_login
def get_business(business_id):
    try:
        row = get_business_or_404(business_id)
        if not row:
            return jsonify({'error': 'Business not found'}), 404
        if not can_modify(row, g.user):
            return jsonify({'error': 'You do not have access to this business'}), 403
        return jsonify(row_to_business(row)), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/businesses/<int:business_id>', methods=['PUT'])
@require_login
def update_business(business_id):
    try:
        existing = get_business_or_404(business_id)
        if not existing:
            return jsonify({'error': 'Business not found'}), 404
        if not can_modify(existing, g.user):
            return jsonify({'error': 'You can only edit your own businesses'}), 403

        data = request.get_json() or {}
        errors = validate_business_payload(data)
        if errors:
            return jsonify({'error': 'Validation failed', 'details': errors}), 400

        business = business_from_payload(data)
        business['score'] = calculate_score(
            rating=business['rating'], reviews=business['reviews'],
            website=business['website'], followers=business['followers'],
            engagement=business['engagement'], lastPost=business['last_post']
        )

        response = supabase.table(TABLE).update(
            business).eq('id', business_id).execute()
        if not response.data:
            return jsonify({'error': 'Update failed'}), 500
        return jsonify(row_to_business(response.data[0])), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/businesses/<int:business_id>', methods=['DELETE'])
@require_login
def delete_business(business_id):
    try:
        existing = get_business_or_404(business_id)
        if not existing:
            return jsonify({'error': 'Business not found'}), 404
        if not can_modify(existing, g.user):
            return jsonify({'error': 'You can only delete your own businesses'}), 403

        supabase.table(TABLE).delete().eq('id', business_id).execute()
        return jsonify({'message': 'Deleted', 'id': business_id}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Analytics  (admin = global stats, user = stats for their own businesses)
# ──────────────────────────────────────────────────────────────
@app.route('/api/analytics', methods=['GET'])
@require_login
def get_analytics():
    try:
        query = supabase.table(TABLE).select('*')
        if g.user['role'] != 'admin':
            query = query.eq('owner_id', g.user['id'])
        response = query.execute()
        rows = response.data

        if not rows:
            return jsonify({
                'total_businesses': 0, 'average_score': 0,
                'highest_score': 0, 'lowest_score': 0,
                'tier_breakdown': {'Platinum': 0, 'Gold': 0, 'Silver': 0, 'Bronze': 0},
                'category_breakdown': {}, 'website_adoption': 0
            }), 200

        scores = [int(r['score']) for r in rows]
        tiers = {'Platinum': 0, 'Gold': 0, 'Silver': 0, 'Bronze': 0}
        for s in scores:
            tiers[get_tier(s)['label']] += 1

        categories = {}
        for r in rows:
            categories[r['category']] = categories.get(r['category'], 0) + 1

        with_website = sum(1 for r in rows if r['website'])

        return jsonify({
            'total_businesses': len(rows),
            'average_score': round(sum(scores) / len(scores)),
            'highest_score': max(scores),
            'lowest_score': min(scores),
            'tier_breakdown': tiers,
            'category_breakdown': categories,
            'website_adoption': round(with_website / len(rows) * 100)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/recommendations/<int:business_id>', methods=['GET'])
@require_login
def get_recommendations_endpoint(business_id):
    try:
        row = get_business_or_404(business_id)
        if not row:
            return jsonify({'error': 'Business not found'}), 404
        if not can_modify(row, g.user):
            return jsonify({'error': 'You do not have access to this business'}), 403

        business = row_to_business(row)
        recs = get_recommendations(business)
        return jsonify(recs), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/rankings', methods=['GET'])
@require_login
def get_rankings():
    """
    Public-ish ranked leaderboard, scoped the same way as the list endpoint:
    regular users only rank among their own businesses, admins see everyone.
    """
    try:
        category = request.args.get('category')
        city = request.args.get('city')

        query = supabase.table(TABLE).select('*')
        if g.user['role'] != 'admin':
            query = query.eq('owner_id', g.user['id'])
        if category and category != 'All':
            query = query.eq('category', category)
        if city and city != 'All':
            query = query.eq('city', city)

        response = query.execute()
        businesses = sorted([row_to_business(r) for r in response.data],
                            key=lambda b: b['score'], reverse=True)

        for i, b in enumerate(businesses):
            b['rank'] = i + 1
            b['tier'] = get_tier(b['score'])

        return jsonify(businesses), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Reports
# ──────────────────────────────────────────────────────────────
@app.route('/api/reports/csv', methods=['GET'])
@require_login
def export_csv():
    try:
        import csv
        import io

        query = supabase.table(TABLE).select('*')
        if g.user['role'] != 'admin':
            query = query.eq('owner_id', g.user['id'])
        response = query.execute()

        businesses = sorted([row_to_business(r) for r in response.data],
                            key=lambda b: b['score'], reverse=True)

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Business', 'Category', 'City', 'Rating', 'Reviews',
                         'Website', 'Followers', 'Engagement%', 'LastPost(days)', 'Score', 'Tier'])
        for b in businesses:
            writer.writerow([b['name'], b['category'], b['city'], b['rating'], b['reviews'],
                             'Yes' if b['website'] else 'No', b['followers'], b['engagement'],
                             b['lastPost'], b['score'], get_tier(b['score'])['label']])

        from flask import Response
        return Response(output.getvalue(), mimetype='text/csv',
                        headers={'Content-Disposition': 'attachment; filename=bdps_report.csv'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Admin — user management
# ──────────────────────────────────────────────────────────────
@app.route('/api/admin/users', methods=['GET'])
@require_admin
def admin_list_users():
    try:
        profiles_resp = supabase.table(PROFILES).select('*').execute()
        biz_resp = supabase.table(TABLE).select('id, owner_id').execute()

        counts = {}
        for b in biz_resp.data:
            counts[b['owner_id']] = counts.get(b['owner_id'], 0) + 1

        users = []
        for p in profiles_resp.data:
            entry = row_to_profile(p)
            entry['businessCount'] = counts.get(p['id'], 0)
            users.append(entry)

        users.sort(key=lambda u: u['createdAt'] or '', reverse=True)
        return jsonify(users), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users/<user_id>/role', methods=['PUT'])
@require_admin
def admin_set_user_role(user_id):
    try:
        data = request.get_json() or {}
        role = data.get('role')
        if role not in ('admin', 'user'):
            return jsonify({'error': "Role must be 'admin' or 'user'"}), 400

        response = supabase.table(PROFILES).update(
            {'role': role}).eq('id', user_id).execute()
        if not response.data:
            return jsonify({'error': 'User not found'}), 404
        return jsonify(row_to_profile(response.data[0])), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users/<user_id>/active', methods=['PUT'])
@require_admin
def admin_set_user_active(user_id):
    try:
        data = request.get_json() or {}
        is_active = data.get('isActive')
        if not isinstance(is_active, bool):
            return jsonify({'error': 'isActive must be true or false'}), 400

        response = supabase.table(PROFILES).update(
            {'is_active': is_active}).eq('id', user_id).execute()
        if not response.data:
            return jsonify({'error': 'User not found'}), 404
        return jsonify(row_to_profile(response.data[0])), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Bulk import (admin only)
# ──────────────────────────────────────────────────────────────
@app.route('/api/import', methods=['POST'])
@require_admin
def import_businesses():
    try:
        data = request.get_json()
        if not isinstance(data, list):
            return jsonify({'error': 'Expected a JSON array of businesses'}), 400

        owner_id = request.args.get('ownerId', g.user['id'])
        to_insert = []
        all_errors = []

        for idx, item in enumerate(data):
            errors = validate_business_payload(item)
            if errors:
                all_errors.append({'row': idx, 'errors': errors})
                continue
            b = business_from_payload(item)
            b['owner_id'] = owner_id
            b['score'] = calculate_score(
                rating=b['rating'], reviews=b['reviews'], website=b['website'],
                followers=b['followers'], engagement=b['engagement'], lastPost=b['last_post']
            )
            to_insert.append(b)

        if all_errors and not to_insert:
            return jsonify({'error': 'All rows failed validation', 'details': all_errors}), 400

        response = supabase.table(TABLE).insert(
            to_insert).execute() if to_insert else None
        return jsonify({
            'message': f'{len(to_insert)} businesses imported',
            'businesses': [row_to_business(r) for r in (response.data if response else [])],
            'failed': all_errors
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Error handlers
# ──────────────────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
