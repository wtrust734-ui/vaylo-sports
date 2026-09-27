export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_deletion_events: {
        Row: {
          created_at: string
          id: string
          region: string | null
          status: string
          user_ref: string
        }
        Insert: {
          created_at?: string
          id?: string
          region?: string | null
          status?: string
          user_ref: string
        }
        Update: {
          created_at?: string
          id?: string
          region?: string | null
          status?: string
          user_ref?: string
        }
        Relationships: []
      }
      accountability_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      accountability_members: {
        Row: {
          group_id: string
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          group_id?: string
          id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accountability_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "accountability_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      achievements: {
        Row: {
          description: string | null
          earned_at: string
          icon: string | null
          id: string
          share_count: number
          title: string
          type: string
          user_id: string
        }
        Insert: {
          description?: string | null
          earned_at?: string
          icon?: string | null
          id?: string
          share_count?: number
          title: string
          type: string
          user_id: string
        }
        Update: {
          description?: string | null
          earned_at?: string
          icon?: string | null
          id?: string
          share_count?: number
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      activity_hypes: {
        Row: {
          activity_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_hypes_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "shared_activities"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_position: {
        Row: {
          position: string | null
          primary_sport: string | null
          secondary_sport: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          position?: string | null
          primary_sport?: string | null
          secondary_sport?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          position?: string | null
          primary_sport?: string | null
          secondary_sport?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      avatar_catalog: {
        Row: {
          category: string
          cost: number
          item_id: string
          rarity: string
          updated_at: string
        }
        Insert: {
          category: string
          cost?: number
          item_id: string
          rarity?: string
          updated_at?: string
        }
        Update: {
          category?: string
          cost?: number
          item_id?: string
          rarity?: string
          updated_at?: string
        }
        Relationships: []
      }
      avatar_items: {
        Row: {
          acquired_at: string
          category: string
          id: string
          item_id: string
          rarity: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          category: string
          id?: string
          item_id: string
          rarity?: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          category?: string
          id?: string
          item_id?: string
          rarity?: string
          user_id?: string
        }
        Relationships: []
      }
      avatars: {
        Row: {
          accessory: string | null
          background: string
          badge: string | null
          base: string
          created_at: string
          display_name: string | null
          extras: Json
          headgear: string | null
          is_setup: boolean
          outfit: string | null
          pose: string
          prestige_level: number
          skin_tone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accessory?: string | null
          background?: string
          badge?: string | null
          base?: string
          created_at?: string
          display_name?: string | null
          extras?: Json
          headgear?: string | null
          is_setup?: boolean
          outfit?: string | null
          pose?: string
          prestige_level?: number
          skin_tone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accessory?: string | null
          background?: string
          badge?: string | null
          base?: string
          created_at?: string
          display_name?: string | null
          extras?: Json
          headgear?: string | null
          is_setup?: boolean
          outfit?: string | null
          pose?: string
          prestige_level?: number
          skin_tone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      basket_items: {
        Row: {
          created_at: string
          id: string
          price_cents: number
          product_id: string
          product_name: string
          product_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          price_cents?: number
          product_id: string
          product_name: string
          product_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          price_cents?: number
          product_id?: string
          product_name?: string
          product_type?: string
          user_id?: string
        }
        Relationships: []
      }
      brand_metrics: {
        Row: {
          count: number
          day: string
          kind: string
          placement_id: string
        }
        Insert: {
          count?: number
          day?: string
          kind: string
          placement_id: string
        }
        Update: {
          count?: number
          day?: string
          kind?: string
          placement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_metrics_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "brand_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_placements: {
        Row: {
          active: boolean
          body: string | null
          brand_id: string
          created_at: string
          cta_label: string | null
          cta_url: string | null
          disclosure_label: string
          ends_at: string | null
          headline: string
          id: string
          min_age: number
          placement: string
          regions: string[]
          sports: string[]
          starts_at: string | null
          weight: number
        }
        Insert: {
          active?: boolean
          body?: string | null
          brand_id: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          disclosure_label?: string
          ends_at?: string | null
          headline: string
          id?: string
          min_age?: number
          placement: string
          regions?: string[]
          sports?: string[]
          starts_at?: string | null
          weight?: number
        }
        Update: {
          active?: boolean
          body?: string | null
          brand_id?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          disclosure_label?: string
          ends_at?: string | null
          headline?: string
          id?: string
          min_age?: number
          placement?: string
          regions?: string[]
          sports?: string[]
          starts_at?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "brand_placements_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          contact_email: string | null
          contract_currency: string
          contract_price_cents: number | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          notes: string | null
          slug: string
          status: string
          updated_at: string
          website: string | null
        }
        Insert: {
          contact_email?: string | null
          contract_currency?: string
          contract_price_cents?: number | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          notes?: string | null
          slug: string
          status?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          contact_email?: string | null
          contract_currency?: string
          contract_price_cents?: number | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          notes?: string | null
          slug?: string
          status?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      challenge_participants: {
        Row: {
          challenge_id: string
          completed_at: string | null
          id: string
          joined_at: string
          progress: number
          status: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          completed_at?: string | null
          id?: string
          joined_at?: string
          progress?: number
          status?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          completed_at?: string | null
          id?: string
          joined_at?: string
          progress?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          created_at: string
          creator_id: string
          description: string | null
          end_date: string | null
          icon: string | null
          id: string
          is_official: boolean
          participant_count: number
          reward_credits: number
          reward_points: number
          scope: string
          sponsor_brand_id: string | null
          sponsor_disclosure: string | null
          sponsor_name: string | null
          sport: string | null
          start_date: string
          target_unit: string | null
          target_value: number | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          description?: string | null
          end_date?: string | null
          icon?: string | null
          id?: string
          is_official?: boolean
          participant_count?: number
          reward_credits?: number
          reward_points?: number
          scope?: string
          sponsor_brand_id?: string | null
          sponsor_disclosure?: string | null
          sponsor_name?: string | null
          sport?: string | null
          start_date?: string
          target_unit?: string | null
          target_value?: number | null
          title: string
          type?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          description?: string | null
          end_date?: string | null
          icon?: string | null
          id?: string
          is_official?: boolean
          participant_count?: number
          reward_credits?: number
          reward_points?: number
          scope?: string
          sponsor_brand_id?: string | null
          sponsor_disclosure?: string | null
          sponsor_name?: string | null
          sport?: string | null
          start_date?: string
          target_unit?: string | null
          target_value?: number | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenges_sponsor_brand_id_fkey"
            columns: ["sponsor_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      chest_claims: {
        Row: {
          claimed_at: string
          converted_credits: number
          cycle_number: number
          id: string
          rarity: string
          reward_id: string
          reward_type: string
          user_id: string
          was_duplicate: boolean
        }
        Insert: {
          claimed_at?: string
          converted_credits?: number
          cycle_number: number
          id?: string
          rarity: string
          reward_id: string
          reward_type: string
          user_id: string
          was_duplicate?: boolean
        }
        Update: {
          claimed_at?: string
          converted_credits?: number
          cycle_number?: number
          id?: string
          rarity?: string
          reward_id?: string
          reward_type?: string
          user_id?: string
          was_duplicate?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "chest_claims_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_bookings: {
        Row: {
          client_id: string
          coach_id: string
          created_at: string
          duration_minutes: number
          id: string
          price_cents: number
          rating: number | null
          review: string | null
          starts_at: string
          status: string
          video_link: string | null
        }
        Insert: {
          client_id: string
          coach_id: string
          created_at?: string
          duration_minutes?: number
          id?: string
          price_cents?: number
          rating?: number | null
          review?: string | null
          starts_at: string
          status?: string
          video_link?: string | null
        }
        Update: {
          client_id?: string
          coach_id?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          price_cents?: number
          rating?: number | null
          review?: string | null
          starts_at?: string
          status?: string
          video_link?: string | null
        }
        Relationships: []
      }
      coach_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      coach_memories: {
        Row: {
          category: string
          created_at: string
          id: string
          key: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      coach_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "coach_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          reason: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          reason: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      communities: {
        Row: {
          created_at: string
          description: string | null
          emoji: string
          id: string
          member_count: number
          name: string
          owner_id: string
          privacy: string
          sport: string | null
          trending_score: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          emoji?: string
          id?: string
          member_count?: number
          name: string
          owner_id: string
          privacy?: string
          sport?: string | null
          trending_score?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          emoji?: string
          id?: string
          member_count?: number
          name?: string
          owner_id?: string
          privacy?: string
          sport?: string | null
          trending_score?: number
          updated_at?: string
        }
        Relationships: []
      }
      community_members: {
        Row: {
          community_id: string
          id: string
          joined_at: string
          notifications_enabled: boolean
          role: string
          user_id: string
        }
        Insert: {
          community_id: string
          id?: string
          joined_at?: string
          notifications_enabled?: boolean
          role?: string
          user_id: string
        }
        Update: {
          community_id?: string
          id?: string
          joined_at?: string
          notifications_enabled?: boolean
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      community_pinned_avatars: {
        Row: {
          community_id: string
          id: string
          pinned_at: string
          position: number
          user_id: string
        }
        Insert: {
          community_id: string
          id?: string
          pinned_at?: string
          position?: number
          user_id: string
        }
        Update: {
          community_id?: string
          id?: string
          pinned_at?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_pinned_avatars_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          community_id: string
          content: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          community_id: string
          content: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          community_id?: string
          content?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_sessions: {
        Row: {
          competition_date: string
          created_at: string
          decision_quality: number | null
          event_id: string | null
          execution_rating: number | null
          fatigue_impact: number | null
          focus_cues: string | null
          id: string
          improvement_priority: string | null
          limiting_factor: string | null
          notes: string | null
          ns_freshness: number | null
          pre_readiness: number | null
          sport: string
          status: string
          tactical_plan: string | null
          title: string
          updated_at: string
          user_id: string
          warmup_plan: string | null
        }
        Insert: {
          competition_date?: string
          created_at?: string
          decision_quality?: number | null
          event_id?: string | null
          execution_rating?: number | null
          fatigue_impact?: number | null
          focus_cues?: string | null
          id?: string
          improvement_priority?: string | null
          limiting_factor?: string | null
          notes?: string | null
          ns_freshness?: number | null
          pre_readiness?: number | null
          sport: string
          status?: string
          tactical_plan?: string | null
          title: string
          updated_at?: string
          user_id: string
          warmup_plan?: string | null
        }
        Update: {
          competition_date?: string
          created_at?: string
          decision_quality?: number | null
          event_id?: string | null
          execution_rating?: number | null
          fatigue_impact?: number | null
          focus_cues?: string | null
          id?: string
          improvement_priority?: string | null
          limiting_factor?: string | null
          notes?: string | null
          ns_freshness?: number | null
          pre_readiness?: number | null
          sport?: string
          status?: string
          tactical_plan?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          warmup_plan?: string | null
        }
        Relationships: []
      }
      country_pricing_map: {
        Row: {
          country_code: string
          country_name: string
          currency: string
          tier_code: string
          updated_at: string
        }
        Insert: {
          country_code: string
          country_name: string
          currency?: string
          tier_code: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          country_name?: string
          currency?: string
          tier_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "country_pricing_map_tier_code_fkey"
            columns: ["tier_code"]
            isOneToOne: false
            referencedRelation: "pricing_tiers"
            referencedColumns: ["code"]
          },
        ]
      }
      creator_profiles: {
        Row: {
          bio: string | null
          created_at: string
          display_name: string
          payout_email: string | null
          specialties: string[] | null
          user_id: string
          verified: boolean
        }
        Insert: {
          bio?: string | null
          created_at?: string
          display_name: string
          payout_email?: string | null
          specialties?: string[] | null
          user_id: string
          verified?: boolean
        }
        Update: {
          bio?: string | null
          created_at?: string
          display_name?: string
          payout_email?: string | null
          specialties?: string[] | null
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          feature: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          reason: string
          source: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          feature?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          reason: string
          source?: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          feature?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          reason?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      cue_words: {
        Row: {
          created_at: string
          id: string
          user_id: string
          word: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          word: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          word?: string
        }
        Relationships: []
      }
      daily_action_logs: {
        Row: {
          action_id: string
          completed: boolean
          created_at: string
          id: string
          log_date: string
          user_id: string
        }
        Insert: {
          action_id: string
          completed?: boolean
          created_at?: string
          id?: string
          log_date?: string
          user_id: string
        }
        Update: {
          action_id?: string
          completed?: boolean
          created_at?: string
          id?: string
          log_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_action_logs_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "daily_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_actions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          process_goal_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          process_goal_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          process_goal_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_actions_process_goal_id_fkey"
            columns: ["process_goal_id"]
            isOneToOne: false
            referencedRelation: "process_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      economy_config: {
        Row: {
          ab_variant: string | null
          active: boolean
          created_at: string
          id: string
          key: string
          region: string
          updated_at: string
          value: Json
        }
        Insert: {
          ab_variant?: string | null
          active?: boolean
          created_at?: string
          id?: string
          key: string
          region?: string
          updated_at?: string
          value: Json
        }
        Update: {
          ab_variant?: string | null
          active?: boolean
          created_at?: string
          id?: string
          key?: string
          region?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      equipment: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_hours: number | null
          max_km: number | null
          name: string
          notes: string | null
          purchased_on: string | null
          type: string
          updated_at: string
          usage_hours: number
          usage_km: number
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_hours?: number | null
          max_km?: number | null
          name: string
          notes?: string | null
          purchased_on?: string | null
          type: string
          updated_at?: string
          usage_hours?: number
          usage_km?: number
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_hours?: number | null
          max_km?: number | null
          name?: string
          notes?: string | null
          purchased_on?: string | null
          type?: string
          updated_at?: string
          usage_hours?: number
          usage_km?: number
          user_id?: string
        }
        Relationships: []
      }
      event_pack_ownership: {
        Row: {
          created_at: string
          id: string
          pack_id: string
          pack_name: string | null
          price_cents: number
          source: string
          sport: string | null
          updated_at: string
          user_id: string
          version_at_purchase: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          pack_id: string
          pack_name?: string | null
          price_cents?: number
          source?: string
          sport?: string | null
          updated_at?: string
          user_id: string
          version_at_purchase?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          pack_id?: string
          pack_name?: string | null
          price_cents?: number
          source?: string
          sport?: string | null
          updated_at?: string
          user_id?: string
          version_at_purchase?: string | null
        }
        Relationships: []
      }
      event_packs: {
        Row: {
          category: string
          created_at: string
          description: string | null
          designed_for: string | null
          difficulty: string
          featured: boolean
          future_updates_included: boolean
          id: string
          includes: string[]
          name: string
          pack_id: string
          popularity: number
          price_cents: number
          retired: boolean
          sections: string[]
          sport: string
          target_event: string | null
          updated_at: string
          version: string
          weeks: number
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          designed_for?: string | null
          difficulty?: string
          featured?: boolean
          future_updates_included?: boolean
          id?: string
          includes?: string[]
          name: string
          pack_id: string
          popularity?: number
          price_cents?: number
          retired?: boolean
          sections?: string[]
          sport: string
          target_event?: string | null
          updated_at?: string
          version?: string
          weeks?: number
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          designed_for?: string | null
          difficulty?: string
          featured?: boolean
          future_updates_included?: boolean
          id?: string
          includes?: string[]
          name?: string
          pack_id?: string
          popularity?: number
          price_cents?: number
          retired?: boolean
          sections?: string[]
          sport?: string
          target_event?: string | null
          updated_at?: string
          version?: string
          weeks?: number
        }
        Relationships: []
      }
      event_rivals: {
        Row: {
          created_at: string
          event_id: string
          id: string
          position: number | null
          result_time: string | null
          rival_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          position?: number | null
          result_time?: string | null
          rival_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          position?: number | null
          result_time?: string | null
          rival_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rivals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actual_position: number | null
          actual_time: string | null
          created_at: string
          distance_km: number | null
          event_date: string
          id: string
          location: string | null
          notes: string | null
          prediction_time: string | null
          sport: string
          strategy: string | null
          title: string
          user_id: string
        }
        Insert: {
          actual_position?: number | null
          actual_time?: string | null
          created_at?: string
          distance_km?: number | null
          event_date: string
          id?: string
          location?: string | null
          notes?: string | null
          prediction_time?: string | null
          sport?: string
          strategy?: string | null
          title: string
          user_id: string
        }
        Update: {
          actual_position?: number | null
          actual_time?: string | null
          created_at?: string
          distance_km?: number | null
          event_date?: string
          id?: string
          location?: string | null
          notes?: string | null
          prediction_time?: string | null
          sport?: string
          strategy?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      fair_usage_events: {
        Row: {
          created_at: string
          feature: string
          id: string
          units: number
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: string
          id?: string
          units?: number
          user_id: string
        }
        Update: {
          created_at?: string
          feature?: string
          id?: string
          units?: number
          user_id?: string
        }
        Relationships: []
      }
      friend_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      friend_requests: {
        Row: {
          created_at: string
          from_user_id: string
          id: string
          status: string
          to_user_id: string
        }
        Insert: {
          created_at?: string
          from_user_id: string
          id?: string
          status?: string
          to_user_id: string
        }
        Update: {
          created_at?: string
          from_user_id?: string
          id?: string
          status?: string
          to_user_id?: string
        }
        Relationships: []
      }
      friendships: {
        Row: {
          created_at: string
          friend_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          friend_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      health_connections: {
        Row: {
          connected: boolean
          created_at: string
          last_cursor: string | null
          last_sync_at: string | null
          metadata: Json
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connected?: boolean
          created_at?: string
          last_cursor?: string | null
          last_sync_at?: string | null
          metadata?: Json
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connected?: boolean
          created_at?: string
          last_cursor?: string | null
          last_sync_at?: string | null
          metadata?: Json
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      health_samples: {
        Row: {
          created_at: string
          deleted: boolean
          end_time: string
          id: string
          metric: string
          source: string
          source_record_id: string
          stage: string | null
          start_time: string
          unit: string
          user_id: string
          value: number | null
          workout_id: string | null
        }
        Insert: {
          created_at?: string
          deleted?: boolean
          end_time: string
          id?: string
          metric: string
          source?: string
          source_record_id: string
          stage?: string | null
          start_time: string
          unit: string
          user_id: string
          value?: number | null
          workout_id?: string | null
        }
        Update: {
          created_at?: string
          deleted?: boolean
          end_time?: string
          id?: string
          metric?: string
          source?: string
          source_record_id?: string
          stage?: string | null
          start_time?: string
          unit?: string
          user_id?: string
          value?: number | null
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "health_samples_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "health_workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      health_sync_state: {
        Row: {
          connected: boolean
          last_incremental_cursor: string | null
          last_sync_at: string | null
          metadata: Json
          synced_workout_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          connected?: boolean
          last_incremental_cursor?: string | null
          last_sync_at?: string | null
          metadata?: Json
          synced_workout_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          connected?: boolean
          last_incremental_cursor?: string | null
          last_sync_at?: string | null
          metadata?: Json
          synced_workout_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      health_workouts: {
        Row: {
          active_calories: number | null
          activity_type: string
          created_at: string
          deleted: boolean
          distance_meters: number | null
          duration_seconds: number | null
          end_time: string
          heart_rate_avg: number | null
          heart_rate_max: number | null
          heart_rate_min: number | null
          id: string
          source: string
          source_record_id: string
          start_time: string
          steps: number | null
          title: string | null
          user_id: string
        }
        Insert: {
          active_calories?: number | null
          activity_type: string
          created_at?: string
          deleted?: boolean
          distance_meters?: number | null
          duration_seconds?: number | null
          end_time: string
          heart_rate_avg?: number | null
          heart_rate_max?: number | null
          heart_rate_min?: number | null
          id?: string
          source?: string
          source_record_id: string
          start_time: string
          steps?: number | null
          title?: string | null
          user_id: string
        }
        Update: {
          active_calories?: number | null
          activity_type?: string
          created_at?: string
          deleted?: boolean
          distance_meters?: number | null
          duration_seconds?: number | null
          end_time?: string
          heart_rate_avg?: number | null
          heart_rate_max?: number | null
          heart_rate_min?: number | null
          id?: string
          source?: string
          source_record_id?: string
          start_time?: string
          steps?: number | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      hrv_baselines: {
        Row: {
          created_at: string
          date: string
          hrv_7day_avg: number | null
          id: string
          rhr_7day_avg: number | null
          trend: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          hrv_7day_avg?: number | null
          id?: string
          rhr_7day_avg?: number | null
          trend?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          hrv_7day_avg?: number | null
          id?: string
          rhr_7day_avg?: number | null
          trend?: string | null
          user_id?: string
        }
        Relationships: []
      }
      injury_logs: {
        Row: {
          body_part: string
          created_at: string
          id: string
          log_date: string
          notes: string | null
          recovery_protocol: string | null
          severity: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body_part: string
          created_at?: string
          id?: string
          log_date?: string
          notes?: string | null
          recovery_protocol?: string | null
          severity?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body_part?: string
          created_at?: string
          id?: string
          log_date?: string
          notes?: string | null
          recovery_protocol?: string | null
          severity?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      learning_feedback: {
        Row: {
          created_at: string
          id: string
          lesson_id: string
          rating: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id: string
          rating: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string
          rating?: string
          user_id?: string
        }
        Relationships: []
      }
      learning_progress: {
        Row: {
          category: string
          completed: boolean
          completed_at: string | null
          created_at: string
          id: string
          lesson_id: string
          mastery_level: number
          quiz_score: number | null
          saved: boolean
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          category: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          lesson_id: string
          mastery_level?: number
          quiz_score?: number | null
          saved?: boolean
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          category?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          lesson_id?: string
          mastery_level?: number
          quiz_score?: number | null
          saved?: boolean
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: []
      }
      marketplace_listings: {
        Row: {
          active: boolean
          category: string
          cover_url: string | null
          created_at: string
          creator_id: string
          description: string | null
          duration_minutes: number | null
          id: string
          price_cents: number
          rating: number | null
          sales_count: number
          title: string
        }
        Insert: {
          active?: boolean
          category: string
          cover_url?: string | null
          created_at?: string
          creator_id: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          price_cents?: number
          rating?: number | null
          sales_count?: number
          title: string
        }
        Update: {
          active?: boolean
          category?: string
          cover_url?: string | null
          created_at?: string
          creator_id?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          price_cents?: number
          rating?: number | null
          sales_count?: number
          title?: string
        }
        Relationships: []
      }
      meal_logs: {
        Row: {
          calories: number | null
          carbs_g: number | null
          fat_g: number | null
          id: string
          log_date: string
          logged_at: string
          meal_type: string
          name: string
          protein_g: number | null
          user_id: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          fat_g?: number | null
          id?: string
          log_date?: string
          logged_at?: string
          meal_type?: string
          name: string
          protein_g?: number | null
          user_id: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          fat_g?: number | null
          id?: string
          log_date?: string
          logged_at?: string
          meal_type?: string
          name?: string
          protein_g?: number | null
          user_id?: string
        }
        Relationships: []
      }
      mental_checkins: {
        Row: {
          confidence: number
          created_at: string
          fatigue: number
          focus: number
          id: string
          message: string | null
          motivation: number
          readiness_score: number
          stress: number
          user_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          fatigue?: number
          focus?: number
          id?: string
          message?: string | null
          motivation?: number
          readiness_score?: number
          stress?: number
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          fatigue?: number
          focus?: number
          id?: string
          message?: string | null
          motivation?: number
          readiness_score?: number
          stress?: number
          user_id?: string
        }
        Relationships: []
      }
      mental_reviews: {
        Row: {
          changes: string | null
          created_at: string
          id: string
          user_id: string
          went_well: string | null
          went_wrong: string | null
        }
        Insert: {
          changes?: string | null
          created_at?: string
          id?: string
          user_id: string
          went_well?: string | null
          went_wrong?: string | null
        }
        Update: {
          changes?: string | null
          created_at?: string
          id?: string
          user_id?: string
          went_well?: string | null
          went_wrong?: string | null
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          challenge_deadlines: boolean
          friend_activity: boolean
          quiet_end: string | null
          quiet_start: string | null
          reengagement: boolean
          streak_alerts: boolean
          updated_at: string
          user_id: string
          workout_reminders: boolean
        }
        Insert: {
          challenge_deadlines?: boolean
          friend_activity?: boolean
          quiet_end?: string | null
          quiet_start?: string | null
          reengagement?: boolean
          streak_alerts?: boolean
          updated_at?: string
          user_id: string
          workout_reminders?: boolean
        }
        Update: {
          challenge_deadlines?: boolean
          friend_activity?: boolean
          quiet_end?: string | null
          quiet_start?: string | null
          reengagement?: boolean
          streak_alerts?: boolean
          updated_at?: string
          user_id?: string
          workout_reminders?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_plans: {
        Row: {
          active: boolean
          calories_target: number | null
          carbs_target: number | null
          created_at: string
          fat_target: number | null
          goal: string | null
          id: string
          plan_data: Json | null
          protein_target: number | null
          title: string
          user_id: string
          weeks: number
        }
        Insert: {
          active?: boolean
          calories_target?: number | null
          carbs_target?: number | null
          created_at?: string
          fat_target?: number | null
          goal?: string | null
          id?: string
          plan_data?: Json | null
          protein_target?: number | null
          title: string
          user_id: string
          weeks?: number
        }
        Update: {
          active?: boolean
          calories_target?: number | null
          carbs_target?: number | null
          created_at?: string
          fat_target?: number | null
          goal?: string | null
          id?: string
          plan_data?: Json | null
          protein_target?: number | null
          title?: string
          user_id?: string
          weeks?: number
        }
        Relationships: []
      }
      outcome_goals: {
        Row: {
          category: string
          created_at: string
          current_value: number | null
          deadline: string | null
          description: string | null
          id: string
          metric_unit: string | null
          start_value: number | null
          status: string
          target_value: number | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          current_value?: number | null
          deadline?: string | null
          description?: string | null
          id?: string
          metric_unit?: string | null
          start_value?: number | null
          status?: string
          target_value?: number | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          current_value?: number | null
          deadline?: string | null
          description?: string | null
          id?: string
          metric_unit?: string | null
          start_value?: number | null
          status?: string
          target_value?: number | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      performance_logs: {
        Row: {
          calories_burned: number | null
          created_at: string
          distance_km: number | null
          form_rating: number | null
          heart_rate_avg: number | null
          id: string
          log_date: string
          log_type: string
          notes: string | null
          pace_per_km: string | null
          perceived_exertion: number | null
          sport: string | null
          time_seconds: number | null
          title: string | null
          user_id: string
        }
        Insert: {
          calories_burned?: number | null
          created_at?: string
          distance_km?: number | null
          form_rating?: number | null
          heart_rate_avg?: number | null
          id?: string
          log_date?: string
          log_type?: string
          notes?: string | null
          pace_per_km?: string | null
          perceived_exertion?: number | null
          sport?: string | null
          time_seconds?: number | null
          title?: string | null
          user_id: string
        }
        Update: {
          calories_burned?: number | null
          created_at?: string
          distance_km?: number | null
          form_rating?: number | null
          heart_rate_avg?: number | null
          id?: string
          log_date?: string
          log_type?: string
          notes?: string | null
          pace_per_km?: string | null
          perceived_exertion?: number | null
          sport?: string | null
          time_seconds?: number | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      performance_metrics: {
        Row: {
          created_at: string
          fatigue_level: number | null
          id: string
          log_date: string
          metric_type: string
          notes: string | null
          sport: string | null
          unit: string
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          fatigue_level?: number | null
          id?: string
          log_date?: string
          metric_type: string
          notes?: string | null
          sport?: string | null
          unit?: string
          user_id: string
          value: number
        }
        Update: {
          created_at?: string
          fatigue_level?: number | null
          id?: string
          log_date?: string
          metric_type?: string
          notes?: string | null
          sport?: string | null
          unit?: string
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      plan_events: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          intensity: string | null
          scheduled_date: string
          status: string
          title: string
          training_plan_id: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          intensity?: string | null
          scheduled_date: string
          status?: string
          title: string
          training_plan_id?: string | null
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          intensity?: string | null
          scheduled_date?: string
          status?: string
          title?: string
          training_plan_id?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      points_events: {
        Row: {
          id: string
          occurred_at: string
          points: number
          source: string
          sport: string | null
          user_id: string
        }
        Insert: {
          id?: string
          occurred_at?: string
          points: number
          source: string
          sport?: string | null
          user_id: string
        }
        Update: {
          id?: string
          occurred_at?: string
          points?: number
          source?: string
          sport?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pricing_tiers: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          id: string
          infinite: Json
          name: string
          packs: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          id?: string
          infinite?: Json
          name: string
          packs?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          infinite?: Json
          name?: string
          packs?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      privacy_settings: {
        Row: {
          allow_community_posting: boolean
          allow_friend_requests: boolean
          created_at: string
          group_visibility: string
          id: string
          show_avatar_publicly: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_community_posting?: boolean
          allow_friend_requests?: boolean
          created_at?: string
          group_visibility?: string
          id?: string
          show_avatar_publicly?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_community_posting?: boolean
          allow_friend_requests?: boolean
          created_at?: string
          group_visibility?: string
          id?: string
          show_avatar_publicly?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      process_goals: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          outcome_goal_id: string | null
          title: string
          updated_at: string
          user_id: string
          weekly_target: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          outcome_goal_id?: string | null
          title: string
          updated_at?: string
          user_id: string
          weekly_target?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          outcome_goal_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          weekly_target?: number
        }
        Relationships: [
          {
            foreignKeyName: "process_goals_outcome_goal_id_fkey"
            columns: ["outcome_goal_id"]
            isOneToOne: false
            referencedRelation: "outcome_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          coins: number
          country: string | null
          created_at: string
          credits: number
          date_of_birth: string | null
          experience_level: string | null
          extended_profile: Json | null
          full_name: string | null
          goals: string[] | null
          height_cm: number | null
          id: string
          infinite_credits: boolean | null
          infinite_credits_until: string | null
          onboarding_complete: boolean
          preferred_units: string
          sex: string | null
          sport: string | null
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          coins?: number
          country?: string | null
          created_at?: string
          credits?: number
          date_of_birth?: string | null
          experience_level?: string | null
          extended_profile?: Json | null
          full_name?: string | null
          goals?: string[] | null
          height_cm?: number | null
          id?: string
          infinite_credits?: boolean | null
          infinite_credits_until?: string | null
          onboarding_complete?: boolean
          preferred_units?: string
          sex?: string | null
          sport?: string | null
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          coins?: number
          country?: string | null
          created_at?: string
          credits?: number
          date_of_birth?: string | null
          experience_level?: string | null
          extended_profile?: Json | null
          full_name?: string | null
          goals?: string[] | null
          height_cm?: number | null
          id?: string
          infinite_credits?: boolean | null
          infinite_credits_until?: string | null
          onboarding_complete?: boolean
          preferred_units?: string
          sex?: string | null
          sport?: string | null
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      purchase_analytics: {
        Row: {
          amount_cents: number | null
          bonus_granted: number | null
          created_at: string
          credits_granted: number | null
          currency: string | null
          event_type: string
          id: string
          metadata: Json | null
          offer_slug: string | null
          pack_id: string | null
          region: string | null
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          bonus_granted?: number | null
          created_at?: string
          credits_granted?: number | null
          currency?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          offer_slug?: string | null
          pack_id?: string | null
          region?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          bonus_granted?: number | null
          created_at?: string
          credits_granted?: number | null
          currency?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          offer_slug?: string | null
          pack_id?: string | null
          region?: string | null
          user_id?: string
        }
        Relationships: []
      }
      recovery_logs: {
        Row: {
          adjusted_session: Json | null
          created_at: string
          energy: number | null
          fatigue: number | null
          hrv: number | null
          id: string
          log_date: string
          mood: number | null
          notes: string | null
          readiness_score: number | null
          rest_hours: number | null
          rhr: number | null
          sleep_quality: number | null
          soreness: number | null
          stress: number | null
          user_id: string
        }
        Insert: {
          adjusted_session?: Json | null
          created_at?: string
          energy?: number | null
          fatigue?: number | null
          hrv?: number | null
          id?: string
          log_date?: string
          mood?: number | null
          notes?: string | null
          readiness_score?: number | null
          rest_hours?: number | null
          rhr?: number | null
          sleep_quality?: number | null
          soreness?: number | null
          stress?: number | null
          user_id: string
        }
        Update: {
          adjusted_session?: Json | null
          created_at?: string
          energy?: number | null
          fatigue?: number | null
          hrv?: number | null
          id?: string
          log_date?: string
          mood?: number | null
          notes?: string | null
          readiness_score?: number | null
          rest_hours?: number | null
          rhr?: number | null
          sleep_quality?: number | null
          soreness?: number | null
          stress?: number | null
          user_id?: string
        }
        Relationships: []
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referee_id: string
          referrer_id: string
          reward_granted_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          referee_id: string
          referrer_id: string
          reward_granted_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          referee_id?: string
          referrer_id?: string
          reward_granted_at?: string | null
          status?: string
        }
        Relationships: []
      }
      reward_config: {
        Row: {
          duplicate_conversion: Json
          id: number
          probabilities: Json
          updated_at: string
        }
        Insert: {
          duplicate_conversion?: Json
          id?: number
          probabilities?: Json
          updated_at?: string
        }
        Update: {
          duplicate_conversion?: Json
          id?: number
          probabilities?: Json
          updated_at?: string
        }
        Relationships: []
      }
      reward_definitions: {
        Row: {
          active: boolean
          available_from: string | null
          available_to: string | null
          category: string
          coin_cost: number | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          payload: Json
          rarity: string
          season: string | null
          type: string
          updated_at: string
          weight_override: number | null
        }
        Insert: {
          active?: boolean
          available_from?: string | null
          available_to?: string | null
          category: string
          coin_cost?: number | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id: string
          name: string
          payload?: Json
          rarity: string
          season?: string | null
          type: string
          updated_at?: string
          weight_override?: number | null
        }
        Update: {
          active?: boolean
          available_from?: string | null
          available_to?: string | null
          category?: string
          coin_cost?: number | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          payload?: Json
          rarity?: string
          season?: string | null
          type?: string
          updated_at?: string
          weight_override?: number | null
        }
        Relationships: []
      }
      shared_activities: {
        Row: {
          detail: string | null
          id: string
          shared_at: string
          source_id: string | null
          source_kind: string
          sport: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          detail?: string | null
          id?: string
          shared_at?: string
          source_id?: string | null
          source_kind: string
          sport?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          detail?: string | null
          id?: string
          shared_at?: string
          source_id?: string | null
          source_kind?: string
          sport?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      special_offers: {
        Row: {
          active: boolean
          bonus_flat: number | null
          bonus_multiplier: number | null
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          offer_type: string
          pack_id: string | null
          price_cents: number | null
          region: string | null
          slug: string
          starts_at: string | null
          target_audience: string | null
          title: string
        }
        Insert: {
          active?: boolean
          bonus_flat?: number | null
          bonus_multiplier?: number | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          offer_type: string
          pack_id?: string | null
          price_cents?: number | null
          region?: string | null
          slug: string
          starts_at?: string | null
          target_audience?: string | null
          title: string
        }
        Update: {
          active?: boolean
          bonus_flat?: number | null
          bonus_multiplier?: number | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          offer_type?: string
          pack_id?: string | null
          price_cents?: number | null
          region?: string | null
          slug?: string
          starts_at?: string | null
          target_audience?: string | null
          title?: string
        }
        Relationships: []
      }
      streaks: {
        Row: {
          current_streak: number
          freezes_available: number
          grace_used_on: string | null
          id: string
          last_activity_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          freezes_available?: number
          grace_used_on?: string | null
          id?: string
          last_activity_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          freezes_available?: number
          grace_used_on?: string | null
          id?: string
          last_activity_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          active: boolean
          best_value: boolean
          billing_period: string
          created_at: string
          credit_rollover_limit: number
          currency: string
          fair_usage_daily_ai_calls: number | null
          id: string
          is_lifetime: boolean
          monthly_credit_allowance: number
          name: string
          plan_key: string
          price_pence: number
          product_id: string
          sort_order: number
          unlimited_credits: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          best_value?: boolean
          billing_period: string
          created_at?: string
          credit_rollover_limit?: number
          currency?: string
          fair_usage_daily_ai_calls?: number | null
          id?: string
          is_lifetime?: boolean
          monthly_credit_allowance?: number
          name: string
          plan_key: string
          price_pence: number
          product_id: string
          sort_order?: number
          unlimited_credits?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          best_value?: boolean
          billing_period?: string
          created_at?: string
          credit_rollover_limit?: number
          currency?: string
          fair_usage_daily_ai_calls?: number | null
          id?: string
          is_lifetime?: boolean
          monthly_credit_allowance?: number
          name?: string
          plan_key?: string
          price_pence?: number
          product_id?: string
          sort_order?: number
          unlimited_credits?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_interval: string | null
          billing_period: string | null
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          credit_rollover_limit: number
          expires_at: string | null
          id: string
          is_lifetime: boolean
          last_refill_at: string | null
          monthly_credit_allowance: number
          next_refill_at: string | null
          plan_key: string
          plan_type: string
          platform: string | null
          product_id: string | null
          provider: string
          purchase_token: string | null
          renews_at: string | null
          started_at: string | null
          status: string
          trial_ends_at: string | null
          unlimited_credits: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_interval?: string | null
          billing_period?: string | null
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          credit_rollover_limit?: number
          expires_at?: string | null
          id?: string
          is_lifetime?: boolean
          last_refill_at?: string | null
          monthly_credit_allowance?: number
          next_refill_at?: string | null
          plan_key?: string
          plan_type?: string
          platform?: string | null
          product_id?: string | null
          provider?: string
          purchase_token?: string | null
          renews_at?: string | null
          started_at?: string | null
          status?: string
          trial_ends_at?: string | null
          unlimited_credits?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_interval?: string | null
          billing_period?: string | null
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          credit_rollover_limit?: number
          expires_at?: string | null
          id?: string
          is_lifetime?: boolean
          last_refill_at?: string | null
          monthly_credit_allowance?: number
          next_refill_at?: string | null
          plan_key?: string
          plan_type?: string
          platform?: string | null
          product_id?: string | null
          provider?: string
          purchase_token?: string | null
          renews_at?: string | null
          started_at?: string | null
          status?: string
          trial_ends_at?: string | null
          unlimited_credits?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tactical_plans: {
        Row: {
          competition_id: string | null
          competition_level: string | null
          created_at: string
          environment: string | null
          generated_priorities: Json | null
          id: string
          match_format: string | null
          opponent_style: string | null
          position: string | null
          psychological_cues: string | null
          risk_notes: string | null
          training_adjustments: string | null
          user_id: string
          warmup_customization: string | null
        }
        Insert: {
          competition_id?: string | null
          competition_level?: string | null
          created_at?: string
          environment?: string | null
          generated_priorities?: Json | null
          id?: string
          match_format?: string | null
          opponent_style?: string | null
          position?: string | null
          psychological_cues?: string | null
          risk_notes?: string | null
          training_adjustments?: string | null
          user_id: string
          warmup_customization?: string | null
        }
        Update: {
          competition_id?: string | null
          competition_level?: string | null
          created_at?: string
          environment?: string | null
          generated_priorities?: Json | null
          id?: string
          match_format?: string | null
          opponent_style?: string | null
          position?: string | null
          psychological_cues?: string | null
          risk_notes?: string | null
          training_adjustments?: string | null
          user_id?: string
          warmup_customization?: string | null
        }
        Relationships: []
      }
      team_assignments: {
        Row: {
          assigned_by: string
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          team_id: string
          title: string
        }
        Insert: {
          assigned_by: string
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          team_id: string
          title: string
        }
        Update: {
          assigned_by?: string
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          team_id?: string
          title?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          id: string
          joined_at: string
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          seat_limit: number
          sport: string | null
          tier: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          seat_limit?: number
          sport?: string | null
          tier?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          seat_limit?: number
          sport?: string | null
          tier?: string
        }
        Relationships: []
      }
      training_loads: {
        Row: {
          created_at: string
          duration_minutes: number
          endurance_load: number
          id: string
          log_date: string
          notes: string | null
          skill_load: number
          sprint_load: number
          strength_load: number
          total_rpe: number
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number
          endurance_load?: number
          id?: string
          log_date?: string
          notes?: string | null
          skill_load?: number
          sprint_load?: number
          strength_load?: number
          total_rpe?: number
          user_id: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number
          endurance_load?: number
          id?: string
          log_date?: string
          notes?: string | null
          skill_load?: number
          sprint_load?: number
          strength_load?: number
          total_rpe?: number
          user_id?: string
        }
        Relationships: []
      }
      training_plans: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          duration_weeks: number
          goal: string | null
          id: string
          level: string
          plan_data: Json | null
          sport: string
          title: string
          updated_at: string
          user_id: string
          week_current: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          duration_weeks?: number
          goal?: string | null
          id?: string
          level?: string
          plan_data?: Json | null
          sport: string
          title: string
          updated_at?: string
          user_id: string
          week_current?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          duration_weeks?: number
          goal?: string | null
          id?: string
          level?: string
          plan_data?: Json | null
          sport?: string
          title?: string
          updated_at?: string
          user_id?: string
          week_current?: number
        }
        Relationships: []
      }
      user_consumables: {
        Row: {
          quantity: number
          reward_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          quantity?: number
          reward_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          quantity?: number
          reward_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_consumables_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profile_cosmetics: {
        Row: {
          background_id: string | null
          badge_id: string | null
          border_id: string | null
          effect_id: string | null
          name_color_id: string | null
          theme_id: string | null
          title_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          background_id?: string | null
          badge_id?: string | null
          border_id?: string | null
          effect_id?: string | null
          name_color_id?: string | null
          theme_id?: string | null
          title_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          background_id?: string | null
          badge_id?: string | null
          border_id?: string | null
          effect_id?: string | null
          name_color_id?: string | null
          theme_id?: string | null
          title_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profile_cosmetics_background_id_fkey"
            columns: ["background_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profile_cosmetics_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profile_cosmetics_border_id_fkey"
            columns: ["border_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profile_cosmetics_effect_id_fkey"
            columns: ["effect_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profile_cosmetics_name_color_id_fkey"
            columns: ["name_color_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profile_cosmetics_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profile_cosmetics_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_purchases: {
        Row: {
          currency: string
          id: string
          platform: string | null
          price_cents: number
          product_id: string
          product_type: string
          provider_reference: string | null
          purchased_at: string
          user_id: string
        }
        Insert: {
          currency?: string
          id?: string
          platform?: string | null
          price_cents?: number
          product_id: string
          product_type: string
          provider_reference?: string | null
          purchased_at?: string
          user_id: string
        }
        Update: {
          currency?: string
          id?: string
          platform?: string | null
          price_cents?: number
          product_id?: string
          product_type?: string
          provider_reference?: string | null
          purchased_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_region: {
        Row: {
          country: string
          currency: string
          detected_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          country?: string
          currency?: string
          detected_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          country?: string
          currency?: string
          detected_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_rewards: {
        Row: {
          acquired_at: string
          category: string
          equipped: boolean
          id: string
          rarity: string
          reward_id: string
          source: string
          type: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          category: string
          equipped?: boolean
          id?: string
          rarity: string
          reward_id: string
          source?: string
          type: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          category?: string
          equipped?: boolean
          id?: string
          rarity?: string
          reward_id?: string
          source?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_rewards_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "reward_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_segments: {
        Row: {
          last_purchase_at: string | null
          lifetime_value_cents: number
          purchase_count: number
          segment: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_purchase_at?: string | null
          lifetime_value_cents?: number
          purchase_count?: number
          segment?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_purchase_at?: string | null
          lifetime_value_cents?: number
          purchase_count?: number
          segment?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          ar_metrics: Json
          ar_persona: string
          ar_position: string
          ar_theme: string
          ar_voice_enabled: boolean
          currency: string
          id: string
          updated_at: string
          user_id: string
          water_goal_ml: number
        }
        Insert: {
          ar_metrics?: Json
          ar_persona?: string
          ar_position?: string
          ar_theme?: string
          ar_voice_enabled?: boolean
          currency?: string
          id?: string
          updated_at?: string
          user_id: string
          water_goal_ml?: number
        }
        Update: {
          ar_metrics?: Json
          ar_persona?: string
          ar_position?: string
          ar_theme?: string
          ar_voice_enabled?: boolean
          currency?: string
          id?: string
          updated_at?: string
          user_id?: string
          water_goal_ml?: number
        }
        Relationships: []
      }
      video_form_analyses: {
        Row: {
          created_at: string
          id: string
          model_used: string | null
          overall_score: number | null
          result: Json
          saved: boolean
          sport_type: string
          user_id: string
          video_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          model_used?: string | null
          overall_score?: number | null
          result: Json
          saved?: boolean
          sport_type?: string
          user_id: string
          video_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          model_used?: string | null
          overall_score?: number | null
          result?: Json
          saved?: boolean
          sport_type?: string
          user_id?: string
          video_name?: string | null
        }
        Relationships: []
      }
      vpr_snapshots: {
        Row: {
          archetype: string | null
          created_at: string
          endurance_capacity: number
          id: string
          overall_vpr: number
          position: string | null
          power_index: number
          reaction_efficiency: number
          repeatability: number
          skill_consistency: number
          speed_index: number
          sport: string
          user_id: string
        }
        Insert: {
          archetype?: string | null
          created_at?: string
          endurance_capacity?: number
          id?: string
          overall_vpr?: number
          position?: string | null
          power_index?: number
          reaction_efficiency?: number
          repeatability?: number
          skill_consistency?: number
          speed_index?: number
          sport: string
          user_id: string
        }
        Update: {
          archetype?: string | null
          created_at?: string
          endurance_capacity?: number
          id?: string
          overall_vpr?: number
          position?: string | null
          power_index?: number
          reaction_efficiency?: number
          repeatability?: number
          skill_consistency?: number
          speed_index?: number
          sport?: string
          user_id?: string
        }
        Relationships: []
      }
      water_logs: {
        Row: {
          amount_ml: number
          id: string
          log_date: string
          logged_at: string
          user_id: string
        }
        Insert: {
          amount_ml: number
          id?: string
          log_date?: string
          logged_at?: string
          user_id: string
        }
        Update: {
          amount_ml?: number
          id?: string
          log_date?: string
          logged_at?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_reviews: {
        Row: {
          ai_feedback: string | null
          completion_pct: number
          created_at: string
          id: string
          reliability_score: number
          user_id: string
          week_start: string
        }
        Insert: {
          ai_feedback?: string | null
          completion_pct?: number
          created_at?: string
          id?: string
          reliability_score?: number
          user_id: string
          week_start: string
        }
        Update: {
          ai_feedback?: string | null
          completion_pct?: number
          created_at?: string
          id?: string
          reliability_score?: number
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      workouts: {
        Row: {
          calories_burned: number | null
          completed: boolean
          completed_at: string | null
          created_at: string
          distance_km: number | null
          duration_minutes: number | null
          heart_rate_avg: number | null
          id: string
          notes: string | null
          started_at: string | null
          title: string
          training_plan_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          calories_burned?: number | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          distance_km?: number | null
          duration_minutes?: number | null
          heart_rate_avg?: number | null
          id?: string
          notes?: string | null
          started_at?: string | null
          title: string
          training_plan_id?: string | null
          type?: string
          user_id: string
        }
        Update: {
          calories_burned?: number | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          distance_km?: number | null
          duration_minutes?: number | null
          heart_rate_avg?: number | null
          id?: string
          notes?: string | null
          started_at?: string | null
          title?: string
          training_plan_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_training_plan_id_fkey"
            columns: ["training_plan_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      leaderboard_totals: {
        Row: {
          last_event: string | null
          points: number | null
          sport: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_subscription: {
        Args: {
          p_product_id: string
          p_provider?: string
          p_purchase_token?: string
          p_user: string
        }
        Returns: Json
      }
      add_coins: {
        Args: { p_amount: number; p_reason: string }
        Returns: number
      }
      add_credits: {
        Args: { p_amount: number; p_reason: string }
        Returns: number
      }
      apply_credit_refill: { Args: { p_user?: string }; Returns: Json }
      award_points: {
        Args: { p_points: number; p_source: string; p_sport?: string }
        Returns: number
      }
      cancel_my_subscription: { Args: never; Returns: Json }
      claim_event_pack: {
        Args: {
          p_pack_id: string
          p_pack_name?: string
          p_price_cents?: number
          p_sport?: string
          p_version?: string
        }
        Returns: Json
      }
      coins_per_credit: { Args: never; Returns: number }
      convert_credits_to_coins: { Args: { p_credits: number }; Returns: Json }
      credit_cost: { Args: { p_feature: string }; Returns: number }
      credits_claim_reward: {
        Args: { p_idempotency_key?: string; p_kind: string; p_reason?: string }
        Returns: Json
      }
      credits_grant: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_metadata?: Json
          p_reason: string
          p_source?: string
          p_user: string
        }
        Returns: Json
      }
      credits_spend: {
        Args: {
          p_feature: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_quantity?: number
          p_reason?: string
          p_source?: string
        }
        Returns: Json
      }
      economy_value: { Args: { p_key: string }; Returns: Json }
      equip_cosmetic: { Args: { p_reward_id: string }; Returns: Json }
      find_user_by_friend_code: { Args: { p_code: string }; Returns: string }
      get_my_entitlements: { Args: never; Returns: Json }
      grant_coins: {
        Args: { p_amount: number; p_reason: string; p_user_id: string }
        Returns: number
      }
      grant_unlimited_trial: { Args: { p_days?: number }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_unlimited_credits: { Args: { _user: string }; Returns: boolean }
      is_adult_birthdate: { Args: { p_dob: string }; Returns: boolean }
      is_community_member: {
        Args: { _community_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_member: {
        Args: { _group: string; _user: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { _team: string; _user: string }
        Returns: boolean
      }
      join_challenge: { Args: { p_challenge: string }; Returns: string }
      join_challenge_by_id: { Args: { p_challenge: string }; Returns: Json }
      leave_challenge: { Args: { p_challenge: string }; Returns: boolean }
      purchase_avatar_item: {
        Args: {
          p_category: string
          p_cost: number
          p_item_id: string
          p_rarity: string
        }
        Returns: Json
      }
      purchase_avatar_item_coins: {
        Args: {
          p_category: string
          p_cost: number
          p_item_id: string
          p_rarity: string
        }
        Returns: Json
      }
      purchase_cosmetic: { Args: { p_reward_id: string }; Returns: Json }
      recompute_user_segment: {
        Args: { p_user: string }
        Returns: {
          last_purchase_at: string | null
          lifetime_value_cents: number
          purchase_count: number
          segment: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_segments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_brand_event: {
        Args: { p_kind: string; p_placement_id: string }
        Returns: boolean
      }
      record_fair_usage: {
        Args: { p_feature: string; p_units?: number }
        Returns: Json
      }
      redeem_referral: { Args: { p_code: string }; Returns: Json }
      spend_coins: {
        Args: { p_amount: number; p_reason: string }
        Returns: number
      }
      spend_credits: {
        Args: { p_amount: number; p_reason: string }
        Returns: number
      }
      sponsored_placements: {
        Args: { p_placement: string; p_sport?: string }
        Returns: {
          body: string
          brand_logo_url: string
          brand_name: string
          brand_slug: string
          brand_website: string
          cta_label: string
          cta_url: string
          disclosure_label: string
          headline: string
          placement_id: string
        }[]
      }
      starting_credits: { Args: never; Returns: number }
      top_referrers: {
        Args: { p_days?: number }
        Returns: {
          display_name: string
          rank: number
          referral_count: number
          referrer_id: string
        }[]
      }
      touch_streak:
        | { Args: never; Returns: Json }
        | { Args: { p_date: string }; Returns: Json }
      unequip_cosmetic: { Args: { p_slot: string }; Returns: Json }
      update_challenge_progress: {
        Args: { p_challenge: string; p_delta: number }
        Returns: Json
      }
      viewer_is_adult: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
