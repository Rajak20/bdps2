"""
Scoring and recommendation logic for BDPS.
This logic is mirrored exactly by the Postgres calculate_score() function
in database.sql, so backend-calculated scores always match the database
trigger's calculation (defense in depth — either one alone is correct).
"""
from typing import Dict, List, Any


def calculate_score(rating: float = 4.0, reviews: int = 0, website: bool = False,
                     followers: int = 0, engagement: float = 0, lastPost: int = 30) -> int:
    """Calculate digital presence score (0-100)."""
    rating_score = (rating / 5) * 25
    review_score = min(reviews / 125, 1) * 20
    website_score = 15 if website else 0
    followers_score = min(followers / 2600, 1) * 20
    engagement_score = min(engagement * 2.5, 10) / 10 * 15

    if lastPost <= 7:
        activity_score = 5
    elif lastPost <= 14:
        activity_score = 3
    else:
        activity_score = 1

    total = rating_score + review_score + website_score + followers_score + engagement_score + activity_score
    return round(total)


def get_tier(score: int) -> Dict[str, str]:
    if score >= 85:
        return {'label': 'Platinum', 'emoji': '💎'}
    if score >= 70:
        return {'label': 'Gold', 'emoji': '🥇'}
    if score >= 50:
        return {'label': 'Silver', 'emoji': '🥈'}
    return {'label': 'Bronze', 'emoji': '🥉'}


def get_recommendations(business: Dict[str, Any]) -> List[Dict[str, str]]:
    """Generate AI-style recommendations based on weakest metrics."""
    recommendations = []

    if not business.get('website'):
        recommendations.append({
            'icon': '🌐',
            'title': 'Build a Website',
            'description': 'A professional website adds +15 pts and significantly boosts credibility.',
            'impact': 'High',
            'points': '+15 pts'
        })

    rating = float(business.get('rating', 0))
    if rating < 4.5:
        points = round((4.7 - rating) / 5 * 25)
        recommendations.append({
            'icon': '⭐',
            'title': 'Improve Google Rating',
            'description': 'Encourage customer reviews and respond professionally to all feedback.',
            'impact': 'High',
            'points': f'+{points} pts'
        })

    reviews = int(business.get('reviews', 0))
    if reviews < 500:
        recommendations.append({
            'icon': '💬',
            'title': 'Increase Reviews',
            'description': f'You have {reviews} reviews. Aim for 500+ by prompting happy customers.',
            'impact': 'Medium',
            'points': '+8 pts'
        })

    followers = int(business.get('followers', 0))
    if followers < 10000:
        recommendations.append({
            'icon': '👥',
            'title': 'Grow Social Following',
            'description': 'Run targeted ads, collaborate with local influencers, and post consistently.',
            'impact': 'Medium',
            'points': '+6 pts'
        })

    engagement = float(business.get('engagement', 0))
    if engagement < 4.0:
        recommendations.append({
            'icon': '🔥',
            'title': 'Boost Engagement',
            'description': 'Use Stories, Reels and polls. Reply to every comment within 2 hours.',
            'impact': 'Medium',
            'points': '+4 pts'
        })

    lastPost = int(business.get('lastPost', 30))
    if lastPost > 7:
        recommendations.append({
            'icon': '📅',
            'title': 'Post More Frequently',
            'description': f'Last post was {lastPost} days ago. Aim for at least 3 posts per week.',
            'impact': 'Low',
            'points': '+3 pts'
        })

    return recommendations
